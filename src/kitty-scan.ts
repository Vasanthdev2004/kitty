// ─── Kitty – log scans for the home stats and the seller dashboard ──────────
// Both start at the deploy block (never block 0) and reuse the chunked getLogs helper:
// one request over the whole range, split into chunks only if the RPC rejects it.
import { pad, type PublicClient } from 'viem';
import type { KittyDeployment } from './kitty-config';
import { getKittyLogs, kittyMulticall, selector, val, type DecodedLog } from './kitty-data';
import { computeStats, type KittyStats, type RequestSummary } from './kitty-requests';

/** Block times for a handful of blocks in one parallel round (they share a JSON-RPC batch). */
async function blockTimes(client: PublicClient, blocks: readonly bigint[], cap = 40): Promise<Map<bigint, number>> {
  const times = new Map<bigint, number>();
  await Promise.all([...new Set(blocks)].slice(-cap).map(async bn => {
    try { times.set(bn, Number((await client.getBlock({ blockNumber: bn })).timestamp)); } catch { /* leave blank */ }
  }));
  return times;
}

// ── Live stats ───────────────────────────────────────────────────────────────

/** One getLogs for PotCreated + Funded + Settled, then times for the newest payouts. */
export async function scanStats(client: PublicClient, dep: KittyDeployment): Promise<KittyStats> {
  const logs = await getKittyLogs(client, dep, [[selector('PotCreated'), selector('Funded'), selector('Settled')]]);
  const stats = computeStats(logs);
  const times = await blockTimes(client, stats.recent.map(r => r.blockNumber), 10);
  return { ...stats, recent: stats.recent.map(r => ({ ...r, timestamp: times.get(r.blockNumber) })) };
}

// ── Seller requests ──────────────────────────────────────────────────────────

type PotTuple = readonly [string, string, bigint, bigint, string, number, boolean, bigint, bigint, bigint, boolean];

export interface RequestsScan { items: RequestSummary[]; chainTimestamp: bigint; scannedAt: number }

/**
 * Payment requests this wallet made to itself (creator == recipient == me).
 * Rounds: [PotCreated filtered by recipient, block] -> [one multicall of getPot + block times]
 * -> [Settled logs for the paid ones, to find the payout transaction].
 */
export async function scanRequests(client: PublicClient, dep: KittyDeployment, me: string): Promise<RequestsScan> {
  const meLower = me.toLowerCase();
  const [created, block] = await Promise.all([
    getKittyLogs(client, dep, [selector('PotCreated'), null, null, pad(me as `0x${string}`)]),
    client.getBlock(),
  ]);
  const own = created.filter((l: DecodedLog) => {
    const a = (l.args ?? {}) as { creator?: string; recipient?: string };
    return a.creator?.toLowerCase() === meLower && a.recipient?.toLowerCase() === meLower && l.blockNumber !== null;
  });
  const ids = own.map(l => (l.args as { potId: `0x${string}` }).potId);
  if (ids.length === 0) return { items: [], chainTimestamp: block.timestamp, scannedAt: Date.now() };

  const [pots, times] = await Promise.all([
    kittyMulticall<PotTuple[]>(client, dep, ids.map(id => ({ functionName: 'getPot', args: [id] })), true),
    blockTimes(client, own.map(l => l.blockNumber as bigint)),
  ]);

  const items: RequestSummary[] = [];
  ids.forEach((id, i) => {
    const r = pots[i];
    if (!r.ok) return;
    const [, , goal, deadline, ref, , settled, totalFunded, , count, cancelled] = val(r);
    items.push({
      id, ref, goalRaw: goal, totalFundedRaw: totalFunded, deadline, settled, cancelled: Boolean(cancelled),
      contributorCount: Number(count), createdBlock: own[i].blockNumber as bigint, createdAt: times.get(own[i].blockNumber as bigint),
    });
  });

  const paidIds = items.filter(x => x.settled).map(x => x.id);
  if (paidIds.length > 0) {
    try {
      const settled = await getKittyLogs(client, dep, [selector('Settled'), paidIds]);
      const tx = new Map<string, `0x${string}`>();
      for (const l of settled) {
        const id = (l.args as { potId?: string } | undefined)?.potId;
        if (id && l.transactionHash) tx.set(id.toLowerCase(), l.transactionHash);
      }
      for (const it of items) if (it.settled) it.payoutTx = tx.get(it.id.toLowerCase());
    } catch { /* the CSV just leaves the payout column blank */ }
  }
  return { items, chainTimestamp: block.timestamp, scannedAt: Date.now() };
}

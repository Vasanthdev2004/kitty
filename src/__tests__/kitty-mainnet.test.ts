// ─── Mainnet readiness: chain config, chain-driven copy, session confirmation ─
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { arc, arcTestnet } from 'viem/chains';
import {
  ACTIVE, ACTIVE_CHAIN_ID, ARC_MAINNET_AT, KITTY_DEPLOYMENTS, footerNote, fundsNote, getDeployment, makeDeployment,
  notDeployedTitle, selectChainKey,
} from '../kitty-config';
import { checkKittyPreflight, validateKittyDeployment, type MinimalPublicClient, type StorageLike } from '../kitty-tx';
import { hasMainnetAck, needsMainnetConfirm, rememberMainnetAck } from '../mainnet-ack';
import { describeChipIn, describeCreate, describePayOut, describeRefund } from '../write-summary';
import { MainnetConfirm } from '../components/MainnetConfirm';
import { NetworkPill } from '../components/NetworkPill';
import { config } from '../config';

// tracing.ts patches window/fetch for the Studio panel; the wagmi config only needs registerChain.
vi.mock('../tracing', () => ({ registerChain: () => undefined }));

const ARC_USDC = '0x3600000000000000000000000000000000000000';
const FILLED = { kitty: '0x1111111111111111111111111111111111111111', deployBlock: 12_345n } as const;

const mainnet = () => getDeployment(arc.id);
const filledMainnet = () =>
  makeDeployment('arc', arc, { name: 'Arc', shortName: 'Arc', testnet: false }, FILLED);

function memoryStore(failing = false): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: k => { if (failing) throw new Error('blocked'); return data.get(k) ?? null; },
    setItem: (k, v) => { if (failing) throw new Error('blocked'); data.set(k, v); },
    removeItem: k => { data.delete(k); },
  };
}

describe('chain selection', () => {
  it('defaults to Arc Testnet and only the exact value "arc" selects mainnet', () => {
    expect(selectChainKey(undefined)).toBe('arcTestnet');
    expect(selectChainKey('')).toBe('arcTestnet');
    expect(selectChainKey('arcTestnet')).toBe('arcTestnet');
    expect(selectChainKey('mainnet')).toBe('arcTestnet'); // a typo must never select mainnet
    expect(selectChainKey('arc')).toBe('arc');
    expect(selectChainKey(' ARC ')).toBe('arc');
  });
  it('this build is on the testnet unless VITE_KITTY_CHAIN says otherwise', () => {
    expect(ACTIVE.key).toBe('arcTestnet');
    expect(ACTIVE_CHAIN_ID).toBe(arcTestnet.id);
  });
});

describe('Arc mainnet entry', () => {
  it('uses chain 5042, the viem arc chain, its explorer and Arc USDC with 6 decimals', () => {
    const d = mainnet();
    expect(d.chainId).toBe(5042);
    expect(d.chain).toBe(arc);
    expect(d.chain.rpcUrls.default.http).toEqual([...arc.rpcUrls.default.http]);
    expect(d.chain.rpcUrls.default.http.length).toBeGreaterThan(0);
    expect(d.explorerBase).toBe('https://explorer.arc.io');
    expect(d.usdc.toLowerCase()).toBe(ARC_USDC);
    expect(d.usdcDecimals).toBe(6);
    expect(d.testnet).toBe(false);
  });
  it('sits next to Arc Testnet (5042002), which is unchanged', () => {
    const t = KITTY_DEPLOYMENTS[arcTestnet.id];
    expect(t.chainId).toBe(5042002);
    expect(t.deployed).toBe(true);
    expect(t.kitty).toBe('0x621b7aadfbc5870b95d4d95245529059536da7e5');
    expect(t.deployBlock).toBe(69_829_378n);
    expect(t.faucetUrl).toBeTruthy();
  });
  it('is NOT deployed yet: no address, so every read and write is blocked', () => {
    expect(ARC_MAINNET_AT).toEqual({ kitty: undefined, deployBlock: undefined });
    const d = mainnet();
    expect(d.deployed).toBe(false);
    expect(d.kitty).toBe('0x0000000000000000000000000000000000000000');
    expect(checkKittyPreflight('0x2222222222222222222222222222222222222222', 5042, d))
      .toEqual({ ok: false, reason: 'Kitty is not deployed on Arc yet.' });
  });
  it('filling the address AND the deploy block is all it takes to go live', () => {
    const d = filledMainnet();
    expect(d.deployed).toBe(true);
    expect(d.kitty).toBe(FILLED.kitty);
    expect(d.deployBlock).toBe(12_345n);
    expect(checkKittyPreflight('0x2222222222222222222222222222222222222222', 5042, d)).toMatchObject({ ok: true });
  });
  it('an address without a positive deploy block stays blocked (never scan from block 0)', () => {
    const at = (deployBlock?: bigint) => makeDeployment('arc', arc, { name: 'Arc', shortName: 'Arc', testnet: false }, { kitty: FILLED.kitty, deployBlock });
    expect(at(undefined).deployed).toBe(false);
    expect(at(0n).deployed).toBe(false);
    expect(at(1n).deployed).toBe(true);
  });
  it('mainnet keeps deployment validation: bytecode, token() == Arc USDC, decimals 6', async () => {
    const d = filledMainnet();
    const client = (over: { code?: `0x${string}`; token?: string; decimals?: number } = {}): MinimalPublicClient => ({
      getBytecode: () => Promise.resolve(over.code ?? '0x6080'),
      readContract: (a: { functionName: string }) =>
        Promise.resolve(a.functionName === 'token' ? (over.token ?? d.usdc) : (over.decimals ?? 6)),
      waitForTransactionReceipt: () => Promise.reject(new Error('unused')),
    });
    expect((await validateKittyDeployment(client(), d)).ok).toBe(true);
    expect((await validateKittyDeployment(client({ code: '0x' }), d)).ok).toBe(false);
    expect((await validateKittyDeployment(client({ token: '0x2222222222222222222222222222222222222222' }), d)).ok).toBe(false);
    expect((await validateKittyDeployment(client({ decimals: 18 }), d)).ok).toBe(false);
  });
});

describe('wagmi config', () => {
  it('includes both Arc chains and no Ethereum mainnet (no ENS lookups in the app)', () => {
    const ids = config.chains.map(c => c.id);
    expect(ids).toContain(5042002);
    expect(ids).toContain(5042);
    expect(ids).not.toContain(1);
  });
});

describe('chain-driven copy', () => {
  const dashes = /[\u2013\u2014]/;
  it('testnet footer says test USDC has no real value', () => {
    expect(footerNote(KITTY_DEPLOYMENTS[arcTestnet.id])).toBe('Arc Testnet only. Test USDC has no real value.');
    expect(fundsNote(KITTY_DEPLOYMENTS[arcTestnet.id])).toBe('Arc Testnet uses test USDC with no real value.');
  });
  it('mainnet footer is the real-funds warning, verbatim', () => {
    expect(footerNote(mainnet())).toBe('Kitty moves real USDC on Arc. Payouts cannot be reversed. Only chip in to kitties you trust.');
    expect(fundsNote(mainnet())).toBe('This moves real USDC.');
    expect(mainnet().faucetUrl).toBeUndefined(); // no "Get test USDC" hint on mainnet
  });
  it('not-deployed title comes from config', () => {
    expect(notDeployedTitle(mainnet())).toBe('Kitty is not deployed on Arc yet');
  });
  it('has no dashes in any of it', () => {
    for (const d of [KITTY_DEPLOYMENTS[arcTestnet.id], mainnet()]) {
      expect(footerNote(d)).not.toMatch(dashes);
      expect(fundsNote(d)).not.toMatch(dashes);
      expect(notDeployedTitle(d)).not.toMatch(dashes);
    }
  });
  it('the Testnet pill shows on testnet only', () => {
    expect(renderToString(createElement(NetworkPill, { dep: { testnet: true } }))).toContain('Testnet');
    expect(renderToString(createElement(NetworkPill, { dep: { testnet: false } }))).toBe('');
  });
});

describe('one-time mainnet confirmation', () => {
  it('testnet never asks', () => {
    expect(needsMainnetConfirm(KITTY_DEPLOYMENTS[arcTestnet.id], memoryStore())).toBe(false);
  });
  it('mainnet asks until the user has said "Got it", then not again this session', () => {
    const store = memoryStore();
    const d = filledMainnet();
    expect(needsMainnetConfirm(d, store)).toBe(true);
    rememberMainnetAck(d, store);
    expect(hasMainnetAck(d, store)).toBe(true);
    expect(needsMainnetConfirm(d, store)).toBe(false);
  });
  it('blocked storage means it keeps asking (fails safe)', () => {
    const store = memoryStore(true);
    const d = filledMainnet();
    rememberMainnetAck(d, store);
    expect(needsMainnetConfirm(d, store)).toBe(true);
  });
  it('summaries state the amount, the recipient and that a payout cannot be reversed', () => {
    const rcpt = '0x3333333333333333333333333333333333333333';
    const chip = describeChipIn({ ref: 'Gift', amountText: '12.50 USDC', recipient: rcpt });
    expect(chip.rows.map(r => r.value)).toEqual(expect.arrayContaining(['12.50 USDC', rcpt]));
    expect(chip.warnings.join(' ')).toMatch(/cannot be reversed/);
    const create = describeCreate({ ref: 'Gift', goalText: '100.00 USDC', recipient: rcpt, deadlineText: 'Nov 5', modeLabel: 'Open pool' });
    expect(create.rows.some(r => r.value === rcpt && r.mono)).toBe(true);
    expect(create.warnings.join(' ')).toMatch(/cannot be reversed/);
    const pay = describePayOut({ ref: 'Gift', amountText: '100.00 USDC', recipient: rcpt });
    expect(pay.warnings.join(' ')).toMatch(/cannot be reversed/);
    expect(describeRefund({ ref: 'Gift', amountText: '5.00 USDC' }).rows[1].value).toBe('5.00 USDC');
    for (const s of [chip, create, pay]) expect(JSON.stringify(s)).not.toMatch(/[\u2013\u2014]/);
  });
  it('the dialog shows the details and keeps Continue disabled until "Got it" is ticked', () => {
    const html = renderToString(createElement(MainnetConfirm, {
      summary: describeChipIn({ ref: 'Gift', amountText: '12.50 USDC', recipient: '0x3333333333333333333333333333333333333333' }),
      networkName: 'Arc', onCancel: () => undefined, onContinue: () => undefined,
    })).replace(/<!-- -->/g, '');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('12.50 USDC');
    expect(html).toContain('0x3333333333333333333333333333333333333333');
    expect(html).toContain('Got it.');
    expect(html).toContain('real USDC on Arc');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(<span[^>]*>)*Continue/);
  });
});

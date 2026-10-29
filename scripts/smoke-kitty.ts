import { createPublicClient, http } from 'viem';
import { arcTestnet } from 'viem/chains';
import { ACTIVE } from '../src/kitty-config';
import { validateKittyDeployment } from '../src/kitty-tx';
import { readActivity, scanMine, readKitty, isPotNotFound } from '../src/kitty-data';
import { computePotId } from '../src/kitty-core';

const client = createPublicClient({ chain: arcTestnet, transport: http('https://rpc.testnet.arc.network') });
const out: string[] = [];
const v = await validateKittyDeployment(client as never, ACTIVE);
out.push('validateKittyDeployment: ' + JSON.stringify(v));
const salt = ('0x' + '00'.repeat(31) + 'aa') as `0x${string}`;
out.push('local computePotId: ' + computePotId('0x1111111111111111111111111111111111111111', salt));
const head = await client.getBlockNumber();
out.push(`head ${head}, deployBlock ${ACTIVE.deployBlock}, span ${head - ACTIVE.deployBlock}`);
const code = await client.getCode({ address: ACTIVE.kitty });
out.push('code length ' + ((code?.length ?? 2) - 2) / 2 + ' bytes');
const unknown = ('0x' + 'de'.repeat(32)) as `0x${string}`;
try { await readKitty(client, ACTIVE, unknown); out.push('readKitty(unknown): no error?'); }
catch (e) { out.push('readKitty(unknown) -> PotNotFound detected: ' + isPotNotFound(e)); }
const t0 = Date.now();
const act = await readActivity(client, ACTIVE, unknown);
out.push(`readActivity(unknown): ${act.length} items in ${Date.now() - t0}ms`);
const mine = await scanMine(client, ACTIVE, '0x1111111111111111111111111111111111111111');
out.push(`scanMine: ${mine.items.length} kitties, chain ts ${mine.chainTimestamp}`);
console.log(out.join('\n'));

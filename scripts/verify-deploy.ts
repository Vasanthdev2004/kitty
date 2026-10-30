// Read-only post-deploy check for a Kitty contract. Sends no transaction and needs no key.
//
//   forge build
//   bun run scripts/verify-deploy.ts <kitty address> [--rpc <url>] [--usdc <address>]
//
// Checks: code exists and matches the compiled artifact (ignoring the immutable slot that
// holds the token address), token() == USDC, SETTLE_GRACE == 30 days, the contributor caps,
// and totalEscrowLiability == 0 (expected right after a fresh deploy).
import { readFileSync } from 'node:fs';
import { createPublicClient, http, isAddress, type Abi } from 'viem';
import { arc } from 'viem/chains';
import { KITTY_ABI } from '../src/kitty-abi';

const ARC_USDC = '0x3600000000000000000000000000000000000000';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const address = process.argv[2];
if (!address || !isAddress(address)) {
  console.error('Usage: bun run scripts/verify-deploy.ts <kitty address> [--rpc <url>] [--usdc <address>]');
  process.exit(2);
}
const rpc = arg('rpc') ?? process.env.KITTY_RPC_URL ?? arc.rpcUrls.default.http[0];
const usdc = (arg('usdc') ?? ARC_USDC).toLowerCase();

interface Artifact {
  deployedBytecode: { object: string; immutableReferences?: Record<string, Array<{ start: number; length: number }>> };
}
const artifact = JSON.parse(readFileSync('contracts/out/Kitty.sol/Kitty.json', 'utf8')) as Artifact;
const expectedHex = artifact.deployedBytecode.object.replace(/^0x/, '');
const slots = Object.values(artifact.deployedBytecode.immutableReferences ?? {}).flat();

const client = createPublicClient({ transport: http(rpc) });
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

const read = (functionName: string) =>
  client.readContract({ address, abi: KITTY_ABI as unknown as Abi, functionName });

const code = await client.getCode({ address });
const actualHex = (code ?? '0x').replace(/^0x/, '');
check('eth_getCode is not empty', actualHex.length > 0, `${actualHex.length / 2} bytes`);

if (actualHex.length > 0) {
  // Blank the immutable slots (they hold the token address on chain, zeros in the artifact).
  const mask = (hex: string) => {
    const chars = hex.split('');
    for (const { start, length } of slots) for (let i = start * 2; i < (start + length) * 2; i++) chars[i] = '0';
    return chars.join('');
  };
  const sameLength = actualHex.length === expectedHex.length;
  check('code length equals the compiled artifact', sameLength, `on chain ${actualHex.length / 2} bytes, artifact ${expectedHex.length / 2} bytes`);
  check('code matches the compiled artifact (immutable slot ignored)', sameLength && mask(actualHex) === mask(expectedHex),
    sameLength ? 'byte for byte' : 'lengths differ');
}

const token = String(await read('token')).toLowerCase();
check('token() is Arc USDC', token === usdc, token);
const grace = await read('SETTLE_GRACE') as bigint;
check('SETTLE_GRACE is 30 days', grace === 2_592_000n, `${grace} seconds`);
check('MAX_SPLIT_CONTRIBUTORS is 64', (await read('MAX_SPLIT_CONTRIBUTORS')) === 64n, 'caps');
check('MAX_OPEN_CONTRIBUTORS is 256', (await read('MAX_OPEN_CONTRIBUTORS')) === 256n, 'caps');
const liability = await read('totalEscrowLiability') as bigint;
check('totalEscrowLiability is 0 (fresh deploy)', liability === 0n, `${liability}`);

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
const failed = results.filter(r => !r.ok).length;
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed. Do not point the app at this address.`);
process.exit(failed === 0 ? 0 : 1);

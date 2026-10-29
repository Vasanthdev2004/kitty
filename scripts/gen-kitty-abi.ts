// Regenerates src/kitty-abi.ts from the compiled Foundry artifact.
// Run after `forge build`:  bun run kitty:abi
import { readFileSync, writeFileSync } from 'node:fs';

const artifact = JSON.parse(readFileSync('contracts/out/Kitty.sol/Kitty.json', 'utf8')) as { abi: unknown[] };
const body = JSON.stringify(artifact.abi, null, 2);
writeFileSync(
  'src/kitty-abi.ts',
  `// Generated from contracts/out/Kitty.sol/Kitty.json by scripts/gen-kitty-abi.ts. Do not edit by hand.\n` +
    `export const KITTY_ABI = ${body} as const;\n`,
);
console.log(`wrote src/kitty-abi.ts (${artifact.abi.length} entries)`);

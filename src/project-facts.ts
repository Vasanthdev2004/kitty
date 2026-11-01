// ─── Facts shown on the home page and in the README (one place) ─────────────
// README.md quotes the same two test counts; src/__tests__/judge-ready.test.ts fails if they drift.
export const CONTRACT_TESTS = 377;
export const APP_TESTS = 606;

export const STUDIO_APP_URL = 'https://studio.arc.io/app/fb199c2b-afd5-4012-8e12-f128223fe87d';
export const FAUCET_URL = 'https://faucet.circle.com';
export const ARC_BRIDGES_DOC_URL = 'https://docs.arc.io/integrate/infrastructure/bridges';
/** Circle's Arc Portal (run by Circle, not by Kitty): bring USDC from another chain, or buy it with a card. */
export const ARC_PORTAL_DEPOSIT_URL = 'https://portal.arc.io/deposit';
export const ARC_PORTAL_FIAT_URL = 'https://portal.arc.io/deposit/fiat';

export const testFactsText = (c: number = CONTRACT_TESTS, a: number = APP_TESTS): string => `${c} contract tests, ${a} app tests`;

/** Which of the two counts differ from `actual`? Empty means they match. */
export function factsDrift(actual: { contractTests: number; appTests: number }): Array<'contractTests' | 'appTests'> {
  const out: Array<'contractTests' | 'appTests'> = [];
  if (actual.contractTests !== CONTRACT_TESTS) out.push('contractTests');
  if (actual.appTests !== APP_TESTS) out.push('appTests');
  return out;
}

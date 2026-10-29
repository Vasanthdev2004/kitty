// ─── Kitty – shared types ───────────────────────────────────────────────────
import type { ContributionInfo } from './pt-types';

export type KittyMode = 'split' | 'open';

/** One person on a kitty. For open kitties `shareRaw` is 0 (there are no fixed shares). */
export type KittyContributor = ContributionInfo;

export interface KittyData {
  id: `0x${string}`;
  creator: string;
  recipient: string;
  goalRaw: bigint;
  deadline: bigint;
  ref: string;
  mode: KittyMode;
  settled: boolean;
  totalFundedRaw: bigint;
  /** Creator-set minimum for first-time funders (open kitties). */
  minContributionRaw: bigint;
  /** What the contract actually enforces for a first-time funder (0 for split). */
  effectiveMinRaw: bigint;
  contributors: KittyContributor[];
  /** Block timestamp at the last read. Anchors the countdown to the chain clock. */
  chainTimestamp: bigint;
}

export type ActivityKind = 'created' | 'chipped' | 'paid' | 'refunded';

export interface ActivityItem {
  kind: ActivityKind;
  /** Contributor for chipped / refunded, recipient for paid, creator for created. */
  address: string;
  amountRaw?: bigint;
  blockNumber: bigint;
  logIndex: number;
  txHash: `0x${string}`;
  /** Unix seconds from the block, when it could be fetched. */
  timestamp?: number;
}

export type MineRole = 'Created' | 'Chipped in' | 'Recipient' | 'Invited';

/** Everything a My kitties card needs, read once per kitty. */
export interface MineSummary {
  id: `0x${string}`;
  ref: string;
  mode: KittyMode;
  creator: string;
  recipient: string;
  goalRaw: bigint;
  totalFundedRaw: bigint;
  deadline: bigint;
  settled: boolean;
  /** The connected wallet's own numbers on this kitty. */
  myShareRaw: bigint;
  myContributedRaw: bigint;
  myRefunded: boolean;
  roles: MineRole[];
}

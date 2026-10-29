// ─── PayTogether – Types ─────────────────────────────────────────────────────

/** A contributor's draft share entry in the create form */
export interface DraftShare {
  address: string;  // raw input — may be invalid
  amount: string;   // raw input — decimal USDC string, e.g. "60.00"
}

/** Validated form state before any chain interaction.
 *  No tokenAddress field: the token is fixed at contract deployment. */
export interface CreateOrderDraft {
  merchant: string;
  orderRef: string;
  targetUsdc: string;          // decimal string
  deadlineIso: string;         // ISO datetime-local string
  shares: DraftShare[];
}

/** The decoded on-chain order state (from getOrder view call).
 *  token comes from the contract-level token() getter, not per-order. */
export interface OnchainOrder {
  orderId: string;             // bytes32 hex
  merchant: string;
  token: string;               // the deployment's immutable token address
  targetRaw: bigint;           // 6-decimal units
  deadline: bigint;            // unix timestamp
  ref: string;
  settled: boolean;
  totalFundedRaw: bigint;
  contributors: string[];
}

/** A single contributor's contribution data (from getContribution view call) */
export interface ContributionInfo {
  address: string;
  shareRaw: bigint;
  contributedRaw: bigint;
  refunded: boolean;
}

/** Combined order + per-contributor state for display */
export interface OrderViewState {
  order: OnchainOrder;
  contributions: ContributionInfo[];
  /** chain timestamp at last read — used to derive deadline eligibility */
  chainTimestamp: bigint;
}

/** Tx lifecycle states — wallet pending, submitted, confirming, done/failed, or uncertain */
export type TxStatus =
  | { kind: 'idle' }
  | { kind: 'wallet-pending'; label: string }
  | { kind: 'submitted'; hash: `0x${string}`; label: string }
  | { kind: 'confirming'; hash: `0x${string}`; label: string }
  | { kind: 'confirmed'; hash: `0x${string}`; label: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'reverted'; hash: `0x${string}`; message: string }
  /** Receipt lookup timed out / RPC error. Hash is preserved — never resubmit. */
  | { kind: 'uncertain'; hash: `0x${string}`; label: string; reason: string };

/** Validation errors for the create form */
export interface CreateFormErrors {
  merchant?: string;
  orderRef?: string;
  targetUsdc?: string;
  deadlineIso?: string;
  shares?: (string | undefined)[];
  sharesSum?: string;
}

// ─── PayTogether – Contract ABI ──────────────────────────────────────────────
// Hand-authored from PayTogether.sol. Token is immutable (set at constructor).
// All orders on one deployment share the same ERC-20 token.

export const PAY_TOGETHER_ABI = [
  // ── Events ───────────────────────────────────────────────────────────────
  {
    type: 'event', name: 'OrderCreated',
    inputs: [
      { name: 'orderId',  type: 'bytes32', indexed: true },
      { name: 'merchant', type: 'address', indexed: true },
      { name: 'target',   type: 'uint256', indexed: false },
      { name: 'deadline', type: 'uint256', indexed: false },
      { name: 'ref',      type: 'string',  indexed: false },
    ],
  },
  {
    type: 'event', name: 'Funded',
    inputs: [
      { name: 'orderId',     type: 'bytes32', indexed: true },
      { name: 'contributor', type: 'address', indexed: true },
      { name: 'amount',      type: 'uint256', indexed: false },
      { name: 'totalFunded', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Settled',
    inputs: [
      { name: 'orderId',  type: 'bytes32', indexed: true },
      { name: 'merchant', type: 'address', indexed: true },
      { name: 'amount',   type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Refunded',
    inputs: [
      { name: 'orderId',     type: 'bytes32', indexed: true },
      { name: 'contributor', type: 'address', indexed: true },
      { name: 'amount',      type: 'uint256', indexed: false },
    ],
  },
  // ── Constructor ───────────────────────────────────────────────────────────
  {
    type: 'constructor', stateMutability: 'nonpayable',
    inputs: [{ name: 'token_', type: 'address' }],
  },
  // ── Read ──────────────────────────────────────────────────────────────────
  {
    type: 'function', name: 'MAX_CONTRIBUTORS', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    // Immutable token address fixed at construction
    type: 'function', name: 'token', stateMutability: 'view',
    inputs: [], outputs: [{ name: 'token', type: 'address' }],
  },
  {
    type: 'function', name: 'totalEscrowLiability', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'getOrder', stateMutability: 'view',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [
      { name: 'merchant',    type: 'address' },
      { name: 'target',      type: 'uint256' },
      { name: 'deadline',    type: 'uint256' },
      { name: 'ref',         type: 'string'  },
      { name: 'settled',     type: 'bool'    },
      { name: 'totalFunded', type: 'uint256' },
    ],
  },
  {
    type: 'function', name: 'getContributors', stateMutability: 'view',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ name: 'contributors', type: 'address[]' }],
  },
  {
    type: 'function', name: 'getContribution', stateMutability: 'view',
    inputs: [
      { name: 'orderId',     type: 'bytes32' },
      { name: 'contributor', type: 'address' },
    ],
    outputs: [
      { name: 'share',       type: 'uint256' },
      { name: 'contributed', type: 'uint256' },
      { name: 'refunded',    type: 'bool'    },
    ],
  },
  // ── Write ──────────────────────────────────────────────────────────────────
  {
    // No token parameter — token is fixed at deploy time.
    type: 'function', name: 'createOrder', stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId',      type: 'bytes32'   },
      { name: 'merchant',     type: 'address'   },
      { name: 'target',       type: 'uint256'   },
      { name: 'deadline',     type: 'uint256'   },
      { name: 'ref',          type: 'string'    },
      { name: 'contributors', type: 'address[]' },
      { name: 'shares',       type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'fund', stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId', type: 'bytes32' },
      { name: 'amount',  type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'settle', stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function', name: 'refund', stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [],
  },
] as const;

export const ERC20_APPROVE_ABI = [
  {
    type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount',  type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function', name: 'decimals', stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [
      { name: 'owner',   type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

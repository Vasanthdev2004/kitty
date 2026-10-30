// ─── Plain-language summary of a write, shown before the first mainnet write ─
// Pure text builders: what will be sent, to whom, and what cannot be undone.

export interface WriteSummary {
  title: string;
  rows: ReadonlyArray<{ label: string; value: string; mono?: boolean }>;
  /** Short sentences, shown under the rows. */
  warnings: readonly string[];
}

const IRREVERSIBLE = 'When the goal is met, the payout to the recipient is one payment and cannot be reversed.';

export function describeCreate(p: {
  ref: string; goalText: string; recipient: string; deadlineText: string; modeLabel: string;
}): WriteSummary {
  return {
    title: 'Start this kitty',
    rows: [
      { label: 'Kitty', value: p.ref },
      { label: 'Type', value: p.modeLabel },
      { label: 'Goal', value: p.goalText },
      { label: 'Recipient', value: p.recipient, mono: true },
      { label: 'Closes', value: p.deadlineText },
    ],
    warnings: [
      'The recipient, goal and deadline cannot be changed after this.',
      IRREVERSIBLE,
      'Starting a kitty does not move any USDC yet. Only gas is spent.',
    ],
  };
}

export function describeChipIn(p: { ref: string; amountText: string; recipient: string }): WriteSummary {
  return {
    title: 'Chip in',
    rows: [
      { label: 'Kitty', value: p.ref },
      { label: 'Amount', value: p.amountText },
      { label: 'Recipient', value: p.recipient, mono: true },
    ],
    warnings: [
      'Your USDC is locked in the contract until the goal is met or the deadline passes.',
      IRREVERSIBLE,
      'If the goal is not met by the deadline, you can get your own money back.',
    ],
  };
}

export function describePayOut(p: { ref: string; amountText: string; recipient: string }): WriteSummary {
  return {
    title: 'Pay out',
    rows: [
      { label: 'Kitty', value: p.ref },
      { label: 'Amount', value: p.amountText },
      { label: 'Recipient', value: p.recipient, mono: true },
    ],
    warnings: ['This sends the full amount to the recipient in one payment. It cannot be reversed.'],
  };
}

export function describeRefund(p: { ref: string; amountText: string }): WriteSummary {
  return {
    title: 'Get refund',
    rows: [
      { label: 'Kitty', value: p.ref },
      { label: 'Amount', value: p.amountText },
    ],
    warnings: ['This returns your own contribution to your wallet. You can only do it once.'],
  };
}

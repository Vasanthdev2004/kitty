// ─── CSV export (pure) ──────────────────────────────────────────────────────
// Spreadsheet apps run text that starts with = + - @ (or a tab / CR) as a formula.
// Request names are typed by strangers, so any such cell gets a leading apostrophe.
// Quotes, commas and newlines are escaped per RFC 4180.

const FORMULA_START = /^[=+\-@\t\r]/;

export function guardFormula(cell: string): string {
  return FORMULA_START.test(cell) ? `'${cell}` : cell;
}

export function csvCell(value: string | number | bigint | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = guardFormula(raw);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | bigint | null | undefined>>): string {
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

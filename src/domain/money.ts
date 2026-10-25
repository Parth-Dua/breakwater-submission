// CONTRACTS §1, §5 money.ts — integer cents only. Pure.

export function assertCents(value: number): void {
  if (!Number.isSafeInteger(value)) throw new Error("Money must be safe integer cents");
}

/** Integer half-up rounding of numerator / denominator (both non-negative). */
export function roundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n || numerator < 0n) throw new Error("roundHalfUp expects numerator ≥ 0 and denominator > 0");
  const result = (numerator * 2n + denominator) / (denominator * 2n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount exceeds safe integer cents");
  return Number(result);
}

/** Demurrage pro rata: minutes × cents-per-hour / 60, rounded half-up once (CONTRACTS §1). */
export function proRataCents(minutes: number, ratePerHourCents: number): number {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error("Expected non-negative integer minutes");
  assertCents(ratePerHourCents);
  return roundHalfUp(BigInt(minutes) * BigInt(ratePerHourCents), 60n);
}

export function sumCents(values: number[]): number {
  let total = 0n;
  for (const value of values) { assertCents(value); total += BigInt(value); }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("Amount exceeds safe integer cents");
  return Number(total);
}

// CONTRACTS §5: display format for cents (U+2212 minus for negatives).
const MINUS = "−";

/** "$122,150", "−$17,000"; cents shown only when not whole dollars. sign:true adds "+" for positives. */
export function formatUsd(cents: number, opts: { sign?: boolean } = {}): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const body = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: abs % 100 ? 2 : 0, maximumFractionDigits: 2,
  }).format(abs / 100);
  if (cents < 0) return `${MINUS}${body}`;
  return opts.sign && cents > 0 ? `+${body}` : body;
}

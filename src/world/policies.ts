// WORLD §9 policy register and the fiscal calendar (WORLD §1).
import { utc } from "../domain/time";
import type { PeriodDef, PolicyDef } from "./types";

export const POLICIES: PolicyDef[] = [
  { code: "AP_POSTING", params: { maxCents: 5_000_000, requires: ["STATEMENT_COMPLETE", "NO_OPEN_DISPUTE_ABOVE_MATERIALITY"] } },
  { code: "ACCRUAL", params: { maxCentsPerCase: 25_000_000 } },
  { code: "RECOVERY_FILING", params: { maxCents: 5_000_000, strategicRequiresTrader: true } },
  { code: "WAIVER", params: { role: "trader" } },
  { code: "MATERIALITY", params: { thresholdCents: 25_000 } },
  { code: "DEADLINE_FALLBACK", params: { daysBeforeTimeBar: 5 } },
  { code: "PRUDENCE", params: { recognizeRecoverableWhen: "FILED", bookDocumentedDisputes: false } },
  { code: "MEMORY_APPROVAL", params: { procedures: "controller", financialFacts: "controller", nonFinancialFacts: "source_teachback" } },
];

export const POLICY_EFFECTIVE_AT = utc("2026-01-01T00:00");

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
/** Jan–Sep 2026 LOCKED; Oct OPEN (locks 3 Nov 00:00); Nov and Dec OPEN. */
export const PERIODS: PeriodDef[] = MONTHS.map((month, index) => {
  const startAt = utc(`2026-${month}-01T00:00`);
  const endAt = index === 11 ? utc("2027-01-01T00:00") : utc(`2026-${MONTHS[index + 1]}-01T00:00`);
  const code = `2026-${month}`;
  if (index < 9) return { code, startAt, endAt, status: "LOCKED" as const };
  if (index === 9) return { code, startAt, endAt, status: "OPEN" as const, lockAt: utc("2026-11-03T00:00") };
  return { code, startAt, endAt, status: "OPEN" as const };
});

export function periodFor(at: number): PeriodDef {
  const period = PERIODS.find(candidate => at >= candidate.startAt && at < candidate.endAt);
  if (!period) throw new Error(`No fiscal period for ${new Date(at).toISOString()}`);
  return period;
}

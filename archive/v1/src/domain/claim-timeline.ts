import type { DelaySegment, CharterTerms } from "./charters";
import type { Interval } from "./intervals";
export type FinancialInterval = Interval & { treatment: "SUPPORTED" | "DISPUTED" | "UNVERIFIED"; cause: string; evidenceIds: string[] };
// Call only after reconcileClaim has validated signatures, scope, coverage and non-overlap.
export function financialIntervals(interval: Interval, segments: DelaySegment[], terms: CharterTerms): FinancialInterval[] {
  const result: FinancialInterval[] = []; let cursor = interval.startAt;
  for (const segment of [...segments].sort((a, b) => a.startAt - b.startAt)) {
    if (cursor < segment.startAt) result.push({ startAt: cursor, endAt: segment.startAt, treatment: "UNVERIFIED", cause: "UNKNOWN", evidenceIds: [] });
    result.push({ ...segment, treatment: terms.payableCauses.includes(segment.cause) ? "SUPPORTED" : terms.excludedCauses.includes(segment.cause) ? "DISPUTED" : "UNVERIFIED" });
    cursor = segment.endAt;
  }
  if (cursor < interval.endAt) result.push({ startAt: cursor, endAt: interval.endAt, treatment: "UNVERIFIED", cause: "UNKNOWN", evidenceIds: [] });
  return result;
}

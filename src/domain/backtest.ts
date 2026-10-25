import { interpretProcedure, matchProcedure } from "./procedures";
import type { HistoricalCase, Procedure } from "./learning-types";
export function runBacktest(procedure: Procedure, history: HistoricalCase[]) {
  const cases = history.flatMap(item => item.holds.flatMap(hold => {
    const context = { portCode: item.portCode, vesselId: item.vesselId, interval: { from: hold.from, to: hold.to }, missingEvidence: true };
    if (!matchProcedure(procedure, context)) return [];
    const outcome = interpretProcedure(procedure, { context, search: () => item.records });
    return [{ caseCode: item.caseCode, procedureOutcome: outcome.result, humanOutcome: hold.resolution, consistent: outcome.result === "VERIFIED" ? hold.resolution === "VERIFIED" : outcome.result === "ESCALATE" && ["ESCALATED", "REJECTED"].includes(hold.resolution) }];
  }));
  return { cases, consistent: cases.filter(item => item.consistent).length, total: cases.length };
}

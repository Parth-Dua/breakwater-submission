import type { PolicySet } from "./policy";
import type { ClassifierResult, GateDecision, LessonJson } from "./learning-types";

export function decideMemory(input: { lesson: LessonJson; result: ClassifierResult | null; policies: PolicySet }): GateDecision {
  const { lesson, result } = input;
  if (!result) return { status: "NEEDS_REVIEW", reason: "Classifier unavailable", requires: [] };
  if (result.discretionary.noul >= .70 || result.kind.choice === "PRECEDENT" || lesson.diff_type === "COMMERCIAL_DECISION" || lesson.proposed_payload.type === "PRECEDENT") return { status: "PRECEDENT_ONLY", reason: "Commercial judgment — kept as precedent, won't be reused", requires: [] };
  if (result.kind.choice === "POLICY_CHANGE") return { status: "REJECTED", reason: "Policy changes are governed outside memory", requires: [] };
  if (result.kind.confidence < .60 || result.scope.confidence < .50) return { status: "NEEDS_REVIEW", reason: "Low confidence — Controller decides", requires: ["CONTROLLER"] };
  if (lesson.proposed_payload.type === "PROCEDURE") return { status: "PENDING_TEACHBACK", reason: "Confirm scope, backtest, then Controller approval", requires: ["TEACH_BACK", "BACKTEST", "CONTROLLER"] };
  if (lesson.financial_impact) return { status: "PENDING_TEACHBACK", reason: "Confirm the financial rule before reuse", requires: lesson.source.role === "controller" ? ["TEACH_BACK"] : ["TEACH_BACK", "CONTROLLER"] };
  return { status: "PENDING_TEACHBACK", reason: "Confirm the scope before reuse", requires: ["TEACH_BACK"] };
}

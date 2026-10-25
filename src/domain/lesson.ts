import type { LessonJson, MemoryPayload, Procedure, TraceDiff } from "./learning-types";
import { canonicalJson } from "./canonical";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: ObjectValue, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const str = (value: unknown) => typeof value === "string" && value.trim().length > 0;
export function parseMemoryPayload(value: unknown): MemoryPayload | null {
  if (!object(value) || !str(value.type)) return null;
  if (value.type === "PRECEDENT" && keys(value, ["type","summary","counterpartyCode","amountCents"]) && str(value.summary) && (value.counterpartyCode === undefined || str(value.counterpartyCode)) && (value.amountCents === undefined || Number.isSafeInteger(value.amountCents) && Number(value.amountCents) >= 0)) return value as MemoryPayload;
  if (value.type === "CONTRACT_RULE_OVERRIDE" && str(value.formCode) && str(value.clause)) {
    if (value.rule === "EXCEPTIONS_APPLY_ON_DEMURRAGE" && typeof value.value === "boolean" && keys(value, ["type","formCode","clause","rule","value"])) return value as MemoryPayload;
    if (value.rule === "TREATMENT" && ["PORT_CLOSURE","WEATHER","SHIFTING","CUSTOMS_HOLD"].includes(String(value.intervalKind)) && ["COUNT","HALF","EXCLUDE","UNVERIFIED"].includes(String(value.value)) && keys(value, ["type","formCode","clause","rule","intervalKind","value"])) return value as MemoryPayload;
  }
  if (value.type === "COUNTERPARTY_FACT" && keys(value, ["type","counterpartyCode","key","value"]) && str(value.counterpartyCode) && ["SOF_TIMEZONE","INVOICE_INCLUDES_SHIFTING"].includes(String(value.key)) && str(value.value)) return value as MemoryPayload;
  if (value.type !== "PROCEDURE" || !keys(value, ["type","procedure"]) || !object(value.procedure)) return null;
  const p = value.procedure;
  if (!keys(p, ["dslVersion","trigger","grants","steps"]) || p.dslVersion !== 2 || !object(p.trigger) || !keys(p.trigger, ["intervalKind","missingEvidence","ports"]) || p.trigger.intervalKind !== "CUSTOMS_HOLD" || p.trigger.missingEvidence !== "CUSTOMS_RELEASE" || !(p.trigger.ports === "ALL" || Array.isArray(p.trigger.ports) && p.trigger.ports.length > 0 && p.trigger.ports.every(str)) || !Array.isArray(p.grants) || p.grants.length !== 1 || canonicalJson(p.grants[0]) !== canonicalJson({ system: "CUSTOMS_PORTAL", scope: "CASE_VESSEL_AND_INTERVAL" }) || !Array.isArray(p.steps) || p.steps.length < 2 || p.steps.length > 6) return null;
  let searched = false, verified = false, marked = false, escalates = false;
  for (const step of p.steps) {
    if (!object(step)) return null;
    if (step.op === "SEARCH_SOURCE" && keys(step, ["op","system","match"]) && step.system === "CUSTOMS_PORTAL" && object(step.match) && canonicalJson(step.match) === canonicalJson({ vessel: true, interval: true })) searched = true;
    else if (step.op === "VERIFY_DOCUMENT" && searched && keys(step, ["op","checks"]) && Array.isArray(step.checks) && step.checks.includes("SAME_VESSEL") && step.checks.includes("COVERS_INTERVAL") && step.checks.every(check => ["SAME_VESSEL","COVERS_INTERVAL","ISSUER_IS_AUTHORITY"].includes(String(check)))) verified = true;
    else if (step.op === "LINK_EVIDENCE" && verified && keys(step, ["op","target"]) && step.target === "TRIGGER_INTERVAL") { /* fixed link operation */ }
    else if (step.op === "MARK_VERIFIED" && verified && keys(step, ["op"])) marked = true;
    else if (step.op === "ESCALATE_IF_MISSING" && keys(step, ["op","role"]) && step.role === "ops") escalates = true;
    else return null;
  }
  return p.steps[0]?.op === "SEARCH_SOURCE" && p.steps.at(-1)?.op === "ESCALATE_IF_MISSING" && searched && verified && marked && escalates ? { type: "PROCEDURE", procedure: p as Procedure } : null;
}
export type LessonContext = { diff: TraceDiff; caseCode: string; role: string; formCode: string; portCode: string; counterpartyCode: string; history: { corroborating: number; contradicting: number }; amountAtRiskCents: number };
export function payloadConsistent(payload: MemoryPayload, context: LessonContext): boolean {
  const { diff } = context, basis = diff.humanSide.basis as { clause?: string; note?: string } | undefined;
  if (diff.type === "COMMERCIAL_DECISION") return payload.type === "PRECEDENT" && (!payload.counterpartyCode || payload.counterpartyCode === context.counterpartyCode) && (payload.amountCents === undefined || payload.amountCents === Math.max(0, Number(diff.agentSide.amountCents ?? 0) - Number(diff.humanSide.amountCents ?? 0)));
  if (diff.type === "MISSING_SOURCE") return payload.type === "PROCEDURE" && diff.humanSide.system === "CUSTOMS_PORTAL" && diff.humanSide.documentKind === "CUSTOMS_RELEASE" && (payload.procedure.trigger.ports === "ALL" || payload.procedure.trigger.ports.every(code => code === context.portCode));
  if (diff.type !== "VALUE_CORRECTION" || payload.type !== "CONTRACT_RULE_OVERRIDE" || payload.formCode !== context.formCode || payload.clause !== basis?.clause) return false;
  if (/already.*demurrage|on demurrage/i.test(basis.note ?? "") && ["PORT_CLOSURE","WEATHER"].includes(String(diff.humanSide.lineKind)) && diff.humanSide.to === "COUNT") return payload.rule === "EXCEPTIONS_APPLY_ON_DEMURRAGE" && payload.value === false;
  return payload.rule === "TREATMENT" && payload.intervalKind === diff.humanSide.lineKind && payload.value === diff.humanSide.to;
}
const subject = (kind: unknown) => String(kind ?? "time").toLowerCase().replaceAll("_", " ");
const treatment = (value: unknown) => value === "COUNT" ? "in full" : value === "HALF" ? "at half" : value === "EXCLUDE" ? "as excluded" : "as unverified";
export function makeLesson(context: LessonContext, draft: { lesson_text: string; proposed_payload: MemoryPayload }): LessonJson {
  const { diff } = context, basis = diff.humanSide.basis as { clause?: string; note?: string } | undefined;
  const commercial = diff.type === "COMMERCIAL_DECISION", missing = diff.type === "MISSING_SOURCE";
  return { ...draft, diff_type: diff.type, source: { role: context.role, action: commercial ? "ANSWER_SUBMITTED" : missing ? "EVIDENCE_LINKED" : "LINE_EDITED", case: context.caseCode }, agent_did: commercial ? "Proposed the computed claim in full" : missing ? "Asked for evidence after checking available sources" : `Counted ${subject(diff.humanSide.lineKind)} ${treatment(diff.humanSide.from)}`, human_did: commercial ? `${diff.humanSide.option === "WAIVE" ? "Waived" : "Reduced"} the claim: ${diff.humanSide.reason ?? ""}` : missing ? `Found a covering release in ${subject(diff.humanSide.system)}` : `Counted ${subject(diff.humanSide.lineKind)} ${treatment(diff.humanSide.to)}`, human_basis: basis ?? {}, references: { contract_clause: !!basis?.clause, contract_form: context.formCode, counterparty_specific: commercial, amount_specific: commercial && diff.humanSide.amountCents !== undefined, port_specific: false, relationship_language: /(goodwill|relationship|favou?r|key (buyer|client)|one[- ]off|exception)/i.test(String(diff.humanSide.reason ?? "")) }, financial_impact: diff.type === "VALUE_CORRECTION" || commercial || context.amountAtRiskCents > 0, grants_access: draft.proposed_payload.type === "PROCEDURE", history: context.history };
}

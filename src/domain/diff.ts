import { canonicalJson } from "./canonical";
import type { StatementLine } from "./laytime";
import type { AskInput, HumanEvent, TraceDiff, TraceOp } from "./learning-types";

/** Only the final answer's contributing links/edits, and their real open/search ancestors, enter the diff. */
export function computeTraceDiff(input: { agentOps: TraceOp[]; humanEvents: HumanEvent[]; ask: AskInput; statementBefore?: StatementLine[]; statementAfter?: StatementLine[]; agentRecommendation?: string }): TraceDiff[] {
  const events = [...input.humanEvents].sort((a,b) => a.seq - b.seq), answer = input.ask.answer;
  if (!answer) return [];
  const submitted = events.filter(event => event.type === "ANSWER_SUBMITTED").at(-1);
  if (!submitted) return [];
  const past = events.filter(event => event.seq <= submitted.seq), used = new Set<string>([submitted.id]), active = new Map<string, HumanEvent>();
  for (const event of past) if (event.type === "EVIDENCE_LINKED") active.set(canonicalJson(event.payload.evidence), event); else if (event.type === "EVIDENCE_UNLINKED") active.delete(canonicalJson(event.payload.evidence));
  const linkedSources: { event: HumanEvent; opened: HumanEvent; search?: HumanEvent }[] = [];
  for (const ref of answer.evidence ?? []) {
    const event = active.get(canonicalJson(ref)); if (!event || ref.kind !== "DOC") continue;
    const opened = past.filter(candidate => candidate.seq < event.seq && candidate.type === "DOCUMENT_OPENED" && candidate.payload.documentCode === ref.documentId).at(-1); if (!opened) continue;
    used.add(event.id); used.add(opened.id);
    const search = past.filter(candidate => candidate.seq < opened.seq && candidate.type === "SOURCE_SEARCHED" && (candidate.payload.resultDocumentCodes as string[] | undefined)?.includes(ref.documentId) && (opened.payload.searchSeq === undefined || candidate.seq === opened.payload.searchSeq)).at(-1);
    if (search) used.add(search.id);
    linkedSources.push({ event, opened, search });
  }
  const edits = past.filter(event => event.type === "LINE_EDITED" && event.payload.from !== event.payload.to && answer.editIds?.includes(String(event.payload.editId)));
  edits.forEach(event => used.add(event.id));
  const provenanceEventIds = past.filter(event => used.has(event.id)).map(event => event.id), ignoredEventIds = events.filter(event => !used.has(event.id)).map(event => event.id);
  const humanEvidence = past.filter(event => used.has(event.id)).every(event => event.origin === "HUMAN");
  const out: TraceDiff[] = [], systemsTried = [...new Set(input.agentOps.flatMap(op => op.system ? [op.system] : []))];
  for (const source of linkedSources) {
    const system = String(source.opened.payload.system ?? source.search?.payload.system ?? "");
    if (system && !systemsTried.includes(system as typeof systemsTried[number]) && !out.some(diff => diff.type === "MISSING_SOURCE" && diff.humanSide.system === system)) out.push({ type: "MISSING_SOURCE", agentSide: { systemsTried, askedRole: input.ask.role }, humanSide: { system, searchQuery: source.search?.payload.query ?? "", documentKind: source.opened.payload.documentKind ?? "", documentCode: source.opened.payload.documentCode, linkedTo: source.event.payload.linkedTo }, provenanceEventIds, ignoredEventIds, humanEvidence });
  }
  for (const edit of edits) {
    const line = input.statementBefore?.find(line => line.id === edit.payload.lineId);
    out.push({ type: "VALUE_CORRECTION", agentSide: { value: edit.payload.from, ruleSource: line?.overriddenBy?.kind === "MEMORY" ? "MEMORY" : line?.clause ? "REGISTER" : "ENGINE" }, humanSide: { ...edit.payload }, provenanceEventIds, ignoredEventIds, humanEvidence });
  }
  if (input.ask.kind === "COMMERCIAL_DECISION" && answer.optionId !== "PURSUE") out.push({ type: "COMMERCIAL_DECISION", agentSide: { recommendation: input.agentRecommendation ?? "PURSUE", amountCents: input.ask.amountAtRiskCents ?? 0 }, humanSide: { option: answer.optionId, ...(answer.amountCents !== undefined ? { amountCents: answer.amountCents } : {}), reason: answer.reason ?? "" }, provenanceEventIds, ignoredEventIds, humanEvidence });
  return out.length ? out : [{ type: "CONFIRMATION", agentSide: {}, humanSide: {}, provenanceEventIds, ignoredEventIds, humanEvidence }];
}

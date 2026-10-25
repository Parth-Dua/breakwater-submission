import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { currentFacts, intervalFacts, loadCase } from "./agent/state";
import { getSimNow } from "./lib/clock";
import type { HistoricalCase, HumanEvent, TraceOp } from "../src/domain/learning-types";

export async function historicalCases(ctx: QueryCtx, ns: string): Promise<HistoricalCase[]> {
  const now = await getSimNow(ctx, ns), items = await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", ns)).collect(), out: HistoricalCase[] = [];
  for (const item of items.filter(item => item.status === "CLOSED" && item.closedAt !== undefined && item.closedAt <= now)) {
    const b = await loadCase(ctx, item._id), facts = await currentFacts(ctx, ns, item._id);
    const holds = facts.filter(fact => fact.key === "INTERVAL" && fact.establishedBy === "HUMAN").flatMap(fact => { const value = fact.value as { kind?: string; startAt: number; endAt: number; resolution?: string }; return value.kind === "CUSTOMS_HOLD" && ["VERIFIED","ESCALATED","REJECTED"].includes(value.resolution ?? "") ? [{ from: value.startAt, to: value.endAt, resolution: value.resolution as "VERIFIED" | "ESCALATED" | "REJECTED" }] : []; });
    const records = [];
    for (const record of await ctx.db.query("customsRecords").withIndex("by_port_vessel", q => q.eq("ns", ns).eq("portId", b.port._id).eq("vesselId", b.vessel._id)).collect()) {
      if (!holds.some(hold => record.startAt >= hold.from - 86400000 && record.startAt <= hold.to + 86400000)) continue;
      const doc = await ctx.db.get(record.documentId); if (!doc || (doc.receivedAt ?? 0) > (item.closedAt ?? now)) continue;
      records.push({ kind: record.kind, vesselId: String(record.vesselId), from: record.startAt, ...(record.endAt !== undefined ? { to: record.endAt } : {}), documentCode: doc.code, authority: doc.system === "CUSTOMS_PORTAL" && doc.kind === "CUSTOMS_RELEASE" });
    }
    const statements = await ctx.db.query("statements").withIndex("by_case_side_version", q => q.eq("ns", ns).eq("caseId", item._id).eq("side", "PAYABLE")).collect();
    const edits = [];
    for (const statement of statements.slice(-1)) for (const edit of await ctx.db.query("statementEdits").withIndex("by_statement", q => q.eq("ns", ns).eq("statementId", statement._id)).collect()) if (edit.status === "APPLIED") edits.push({ lineKind: statement.lines.find(line => line.id === edit.lineId)?.kind ?? edit.lineId.split(":")[0], from: edit.from, to: edit.to, ...(edit.basis.clause ? { clause: edit.basis.clause } : {}), note: edit.basis.note });
    out.push({ caseCode: item.code, portCode: b.port.code, vesselId: String(b.vessel._id), formCode: b.charter.formCode, holds, records, edits });
  }
  return out;
}
const TRACE: Record<string, TraceOp> = { search_mailbox: { op: "SEARCH", system: "MAILBOX" }, search_customs_portal: { op: "SEARCH", system: "CUSTOMS_PORTAL" }, read_document: { op: "READ", system: "DOC_STORE" }, get_ais: { op: "READ", system: "AIS" }, get_contract_terms: { op: "READ", system: "CONTRACT_REGISTER" }, compute_statement: { op: "COMPUTE" }, reconcile_invoice: { op: "COMPUTE" }, create_ask: { op: "ASK" }, post_ap: { op: "POST" }, file_recovery: { op: "POST" }, post_accrual: { op: "POST" } };
export async function answerData(ctx: QueryCtx, ask: Doc<"asks">) {
  const b = await loadCase(ctx, ask.caseId), stored = await ctx.db.query("humanEvents").withIndex("by_ask_seq", q => q.eq("ns", ask.ns).eq("askId", ask._id)).collect();
  const events: HumanEvent[] = [];
  for (const event of stored) {
    const payload = event.payload as Record<string, unknown>;
    const doc = event.type === "DOCUMENT_OPENED" && typeof payload.documentCode === "string" ? await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", ask.ns).eq("code", payload.documentCode as string)).unique() : null;
    events.push({ id: String(event._id), seq: event.seq, origin: event.origin, type: event.type, payload: { ...payload, ...(doc ? { documentKind: doc.kind, system: doc.system } : {}) } });
  }
  const submittedAt = stored.find(event => event.type === "ANSWER_SUBMITTED")?.wallAt ?? 0;
  const tasks = await ctx.db.query("agentTasks").withIndex("by_case", q => q.eq("ns", ask.ns).eq("caseId", ask.caseId)).collect();
  const steps = await ctx.db.query("agentSteps").withIndex("by_case_seq", q => q.eq("ns", ask.ns).eq("caseId", ask.caseId)).collect();
  const agentOps = steps.filter(step => tasks.some(task => task._id === step.taskId && task.triggerAskId !== ask._id && task.createdAt <= submittedAt)).flatMap(step => step.toolCalls.filter(call => call.allowed && TRACE[call.tool]).map(call => TRACE[call.tool]));
  const originalEdit = ask.answer?.editIds?.[0] ? ctx.db.normalizeId("statementEdits", ask.answer.editIds[0]) : null;
  const edit = originalEdit ? await ctx.db.get(originalEdit) : null, before = edit ? await ctx.db.get(edit.statementId) : null;
  const persona = ask.answeredBy ? await ctx.db.get(ask.answeredBy) : null;
  const intervals = intervalFacts(await currentFacts(ctx, ask.ns, ask.caseId));
  return { b, events, agentOps, before: before?.lines ?? [], persona, submittedAt, intervals };
}

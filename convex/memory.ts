import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { currentPersona, personaByCode, requirePersona, type ActingPersona } from "./lib/persona";
import { getSimNow } from "./lib/clock";
import { fail } from "./lib/errors";
import { appendAudit } from "./lib/audit";
import { automationArg, humanOrigin, recordHuman } from "./human";
import { createAskTx, createTeachBackTx } from "./gateway";
import { historicalCases } from "./learningData";
import { runBacktest } from "../src/domain/backtest";
import { parseMemoryPayload } from "../src/domain/lesson";
import type { ClassifierResult, LessonJson } from "../src/domain/learning-types";

async function controllerAsk(ctx: MutationCtx, item: Doc<"memoryItems">) {
  if (!item.sourceCaseId) fail("NOT_PERMITTED", "No source case");
  const open = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", item.ns).eq("caseId", item.sourceCaseId!)).collect();
  if (!open.some(ask => ask.kind === "APPROVE_MEMORY" && ask.subject === item.code && ask.status === "OPEN")) await createAskTx(ctx, { ns: item.ns, caseId: item.sourceCaseId, need: "MEMORY", subject: item.code, question: "Approve this procedure?", options: [{ id: "APPROVE", label: "Approve" }, { id: "REJECT", label: "Reject", requires: ["REASON"] }], context: { evidence: [] }, createdAt: await getSimNow(ctx, item.ns), actor: "agent:learning", role: "agent", correlationId: `case:${item.sourceCaseId}` });
}
async function resetObserver(ctx: MutationCtx, acting: ActingPersona) {
  const observer = await personaByCode(ctx, "OBSERVER", acting.persona.ns); if (observer) await ctx.db.patch(acting.sessionId, { actingPersonaId: observer._id, updatedAt: Date.now() });
}
/** All governance answers are code decisions. They never enqueue an LLM approval task. */
export async function answerGovernanceTx(ctx: MutationCtx, input: { ask: Doc<"asks">; acting: ActingPersona; optionId: string; reason?: string; automation?: boolean }) {
  const { ask, acting, optionId, reason, automation } = input;
  if (!["TEACH_BACK","APPROVE_MEMORY"].includes(ask.kind) || ask.status !== "OPEN" || ask.role !== acting.persona.role || !ask.options.some(option => option.id === optionId)) fail("NOT_PERMITTED", "This choice is not available");
  const item = await ctx.db.query("memoryItems").withIndex("by_code", q => q.eq("ns", ask.ns).eq("code", ask.subject)).unique();
  if (!item || item.sourceCaseId !== ask.caseId) fail("NOT_PERMITTED", "Memory source does not match");
  const payload = parseMemoryPayload(item.payload);
  if (!payload) fail("NOT_PERMITTED", "Invalid memory payload");
  if (reason !== undefined && (reason.length > 240 || !reason.trim())) fail("NOT_PERMITTED", "Use a reason of at most 240 characters");
  const at = await getSimNow(ctx, ask.ns), origin = humanOrigin(automation);
  let status: Doc<"memoryItems">["status"] = item.status;
  if (ask.kind === "TEACH_BACK") {
    if (item.status !== "PENDING_TEACHBACK" || item.sourcePersonaId !== acting.persona._id) fail("WRONG_ROLE", "The source person confirms this scope");
    if (!["DONT","THIS_CASE"].includes(optionId)) {
      const calls = item.lessonId ? await ctx.db.query("classifierCalls").withIndex("by_lesson", q => q.eq("ns", ask.ns).eq("lessonId", item.lessonId!)).collect() : [];
      if (!calls.some(call => call.status === "OK") || payload.type === "PRECEDENT") fail("NOT_PERMITTED", "A validated classifier result is required before reuse");
    }
    if (optionId === "DONT") { status = "REJECTED"; await ctx.db.patch(item._id, { status, newAtWall: Date.now(), gateDecision: { status, reason: "Source person declined reuse", requires: [] } }); }
    else if (optionId === "THIS_CASE") { status = "PRECEDENT_ONLY"; await ctx.db.patch(item._id, { status, kind: "PRECEDENT", payload: { type: "PRECEDENT", summary: item.title }, scope: { kind: "THIS_CASE", value: String(ask.caseId) }, newAtWall: Date.now(), gateDecision: { status, reason: "Just this case — kept as precedent", requires: [] } }); }
    else if (payload.type === "PROCEDURE") {
      const sourceCase = (await ctx.db.get(ask.caseId))!, voyage = (await ctx.db.get(sourceCase.voyageId))!, port = (await ctx.db.get(voyage.portId))!;
      const procedure = { ...payload.procedure, trigger: { ...payload.procedure.trigger, ports: optionId === "PORT" ? [port.code] : "ALL" as const } };
      const report = runBacktest(procedure, await historicalCases(ctx, ask.ns));
      const backtestId = await ctx.db.insert("backtests", { ns: ask.ns, origin: item.origin, memoryItemId: item._id, cases: report.cases, consistent: report.consistent, total: report.total, ranAt: at });
      status = report.total >= 3 ? "PENDING_CONTROLLER" : "NEEDS_REVIEW";
      await ctx.db.patch(item._id, { status, payload: { type: "PROCEDURE", procedure }, scope: { kind: optionId === "PORT" ? "PORT" : "ALL", ...(optionId === "PORT" ? { value: port.code } : {}) }, backtestId, newAtWall: Date.now(), gateDecision: { status, reason: report.total < 3 ? "More historical cases needed" : report.consistent < report.total ? "Backtest differs — Controller reason required" : "Backtest consistent — Controller approval required", requires: ["CONTROLLER"] } });
      await controllerAsk(ctx, (await ctx.db.get(item._id))!);
    } else {
      const lesson = item.lessonId ? await ctx.db.get(item.lessonId) : null, json = lesson?.lessonJson as LessonJson | undefined;
      status = json?.financial_impact && acting.persona.role !== "controller" ? "PENDING_CONTROLLER" : "ACTIVE";
      await ctx.db.patch(item._id, { status, scope: { kind: optionId === "COUNTERPARTY" ? "COUNTERPARTY" : "CHARTER_FORM", value: payload.type === "CONTRACT_RULE_OVERRIDE" ? payload.formCode : payload.type === "COUNTERPARTY_FACT" ? payload.counterpartyCode : item.code }, newAtWall: Date.now(), ...(status === "ACTIVE" ? { approvedBy: acting.persona._id, approvedAt: at } : {}), gateDecision: { status, reason: status === "ACTIVE" ? "Scope confirmed by the responsible person" : "Financial impact — Controller approval required", requires: status === "ACTIVE" ? [] : ["CONTROLLER"] } });
      if (status === "PENDING_CONTROLLER") await controllerAsk(ctx, (await ctx.db.get(item._id))!);
    }
    await recordHuman(ctx, ask, acting, "TEACHBACK_ANSWERED", { optionId, memoryCode: item.code }, automation);
  } else {
    if (acting.persona.role !== "controller" || !["PENDING_CONTROLLER","NEEDS_REVIEW"].includes(item.status)) fail("WRONG_ROLE", "Controller review is required");
    if (optionId === "REJECT") {
      if (!reason?.trim()) fail("MISSING_EVIDENCE", "Add a reason");
      status = "REJECTED";
    } else {
      if (!item.lessonId || payload.type === "PRECEDENT") fail("NOT_PERMITTED", "This item cannot be activated");
      const calls = await ctx.db.query("classifierCalls").withIndex("by_lesson", q => q.eq("ns", ask.ns).eq("lessonId", item.lessonId!)).collect();
      if (!calls.some(call => call.status === "OK")) fail("NOT_PERMITTED", "A successful classifier result is required");
      const backtest = item.backtestId ? await ctx.db.get(item.backtestId) : null;
      if (payload.type === "PROCEDURE" && !backtest && item.status === "NEEDS_REVIEW") status = "PENDING_TEACHBACK";
      else if (payload.type === "PROCEDURE" && (!backtest || backtest.total < 3)) fail("NOT_PERMITTED", "At least three backtest cases are required");
      if ((item.status === "NEEDS_REVIEW" || backtest && backtest.consistent < backtest.total) && !reason?.trim()) fail("MISSING_EVIDENCE", "Add a reason for this review");
      if (status !== "PENDING_TEACHBACK") status = "ACTIVE";
    }
    await ctx.db.patch(item._id, { status, ...(status === "ACTIVE" ? { approvedBy: acting.persona._id, approvedAt: at } : {}), newAtWall: Date.now(), gateDecision: { status, reason: status === "PENDING_TEACHBACK" ? "Scope review requested" : reason?.trim() ?? "Controller approved after backtest", requires: status === "PENDING_TEACHBACK" ? ["TEACH_BACK","BACKTEST","CONTROLLER"] : [] } });
    if (status === "PENDING_TEACHBACK") await createTeachBackTx(ctx, item._id);
    await recordHuman(ctx, ask, acting, "MEMORY_DECIDED", { decision: optionId, memoryCode: item.code, ...(reason ? { reason } : {}) }, automation);
  }
  await ctx.db.patch(ask._id, { status: "ANSWERED", answer: { optionId, ...(reason ? { reason: reason.trim() } : {}) }, answeredBy: acting.persona._id, answeredAt: at });
  await appendAudit(ctx, { ns: ask.ns, origin, actor: `persona:${acting.persona.code}`, role: acting.persona.role, type: ask.kind === "TEACH_BACK" ? "TEACHBACK_ANSWERED" : "MEMORY_DECIDED", entityType: "memoryItem", entityId: item.code, correlationId: `case:${ask.caseId}`, after: { status, optionId, ...(reason ? { reason } : {}) }, at });
  await resetObserver(ctx, acting);
}
export const decide = mutation({ args: { memoryCode: v.string(), decision: v.union(v.literal("APPROVE"), v.literal("REJECT")), reason: v.optional(v.string()), ...automationArg }, returns: v.null(), handler: async (ctx, { memoryCode, decision, reason, automation }) => {
  const acting = await requirePersona(ctx, ["controller"]), item = await ctx.db.query("memoryItems").withIndex("by_code", q => q.eq("ns", "demo").eq("code", memoryCode)).unique();
  if (!item || !item.sourceCaseId) fail("NOT_PERMITTED", "No candidate memory");
  const ask = (await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", "demo").eq("caseId", item.sourceCaseId!)).collect()).find(ask => ask.kind === "APPROVE_MEMORY" && ask.subject === memoryCode && ask.status === "OPEN");
  if (!ask) fail("STALE_VERSION", "This review is no longer open");
  await answerGovernanceTx(ctx, { ask, acting, optionId: decision, reason, automation }); return null;
} });
export const revoke = mutation({ args: { memoryCode: v.string(), reason: v.string(), ...automationArg }, returns: v.null(), handler: async (ctx, { memoryCode, reason, automation }) => {
  const acting = await requirePersona(ctx, ["controller"]), item = await ctx.db.query("memoryItems").withIndex("by_code", q => q.eq("ns", "demo").eq("code", memoryCode)).unique();
  if (!item || item.status !== "ACTIVE" || !reason.trim() || reason.length > 240) fail("NOT_PERMITTED", "Add a reason to revoke active memory");
  await ctx.db.patch(item._id, { status: "REVOKED", version: item.version + 1, gateDecision: { status: "REVOKED", reason: reason.trim(), requires: [] } });
  if (item.sourceAskId) { const source = await ctx.db.get(item.sourceAskId); if (source) await recordHuman(ctx, source, acting, "MEMORY_DECIDED", { memoryCode, decision: "REVOKE", reason }, automation); }
  await appendAudit(ctx, { ns: "demo", origin: humanOrigin(automation), actor: `persona:${acting.persona.code}`, role: "controller", type: "MEMORY_REVOKED", entityType: "memoryItem", entityId: memoryCode, correlationId: `memory:${memoryCode}`, after: { reason, version: item.version + 1 } }); return null;
} });
export const detail = query({ args: { memoryCode: v.string() }, returns: v.any(), handler: async (ctx, { memoryCode }) => {
  const item = await ctx.db.query("memoryItems").withIndex("by_code", q => q.eq("ns", "demo").eq("code", memoryCode)).unique(); if (!item) return null;
  const acting = await currentPersona(ctx), lesson = item.lessonId ? await ctx.db.get(item.lessonId) : null, json = lesson?.lessonJson as LessonJson | undefined;
  const calls = lesson ? await ctx.db.query("classifierCalls").withIndex("by_lesson", q => q.eq("ns", "demo").eq("lessonId", lesson._id)).collect() : [], call = calls.at(-1), result = call?.status === "OK" ? call.response as ClassifierResult : null;
  const backtest = item.backtestId ? await ctx.db.get(item.backtestId) : null, approver = item.approvedBy ? await ctx.db.get(item.approvedBy) : null;
  const open = item.sourceCaseId ? (await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", "demo").eq("caseId", item.sourceCaseId!)).collect()).some(ask => ask.kind === "APPROVE_MEMORY" && ask.subject === item.code && ask.status === "OPEN") : false;
  const payload = parseMemoryPayload(item.payload);
  return { agentDid: json?.agent_did ?? null, humanDid: json?.human_did ?? null, basis: json?.human_basis ?? null, classifier: result, classifierLabel: call?.status === "OK" ? `Jev ${call.model.replace(/^(?:typesafe\/)?jev-/, "")}` : call ? "Unavailable" : null, reason: item.gateDecision?.reason ?? null, backtest: backtest ? { consistent: backtest.consistent, total: backtest.total, cases: backtest.cases } : null, approvedBy: item.origin === "AUTOMATED_TEST" && approver ? "Automated test" : approver?.displayName ?? null, approvedAt: item.approvedAt ?? null, automated: item.origin === "AUTOMATED_TEST", canReject: acting?.persona.role === "controller" && open, canApprove: acting?.persona.role === "controller" && open && !!result && !!payload && payload.type !== "PRECEDENT" && (payload.type !== "PROCEDURE" || !!backtest && backtest.total >= 3 || !backtest && item.status === "NEEDS_REVIEW"), needsScope: payload?.type === "PROCEDURE" && !backtest && item.status === "NEEDS_REVIEW", canRevoke: acting?.persona.role === "controller" && item.status === "ACTIVE", needsReason: item.status === "NEEDS_REVIEW" || !!backtest && backtest.consistent < backtest.total };
} });

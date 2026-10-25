import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { answerData, historicalCases } from "./learningData";
import { computeTraceDiff } from "../src/domain/diff";
import { precedentSearch } from "../src/domain/precedent-search";
import { makeLesson, parseMemoryPayload, payloadConsistent, type LessonContext } from "../src/domain/lesson";
import { decideMemory } from "../src/domain/memory-gate";
import type { ClassifierResult, LessonJson, MemoryPayload, TraceDiff } from "../src/domain/learning-types";
import { createAskTx, createTeachBackTx, loadPolicies } from "./gateway";
import { getSimNow } from "./lib/clock";
import { appendAudit } from "./lib/audit";

export const claim = internalMutation({ args: { askId: v.id("asks") }, returns: v.any(), handler: async (ctx, { askId }) => {
  const ask = await ctx.db.get(askId); if (!ask || ask.status !== "ANSWERED" || !["CONFIRM_FACT","PAYMENT_APPROVAL","COMMERCIAL_DECISION"].includes(ask.kind)) return null;
  const data = await answerData(ctx, ask), submitted = data.events.find(event => event.type === "ANSWER_SUBMITTED");
  if (!submitted || !["HUMAN","AUTOMATED_TEST"].includes(submitted.origin)) return null;
  const prior = await ctx.db.query("learningRuns").withIndex("by_ask", q => q.eq("ns", ask.ns).eq("askId", askId)).unique();
  if (prior && (prior.state !== "RUNNING" || prior.leaseUntil > Date.now())) return null;
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`, leaseUntil = Date.now() + 300_000;
  if (prior) await ctx.db.patch(prior._id, { leaseToken: token, leaseUntil, updatedAt: Date.now() });
  else await ctx.db.insert("learningRuns", { ns: ask.ns, origin: submitted.origin as "HUMAN" | "AUTOMATED_TEST", askId, state: "RUNNING", leaseToken: token, leaseUntil, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(310_000, internal.learning.processAnswer, { askId });
  const priorDiffs = await ctx.db.query("traceDiffs").withIndex("by_ask", q => q.eq("ns", ask.ns).eq("askId", askId)).collect();
  if (!priorDiffs.length) for (const diff of computeTraceDiff({ agentOps: data.agentOps, humanEvents: data.events, ask, statementBefore: data.before })) await ctx.db.insert("traceDiffs", { ns: ask.ns, origin: diff.humanEvidence ? "HUMAN" : "AUTOMATED_TEST", askId, caseId: ask.caseId, type: diff.type, agentSide: diff.agentSide, humanSide: diff.humanSide, provenanceEventIds: diff.provenanceEventIds as Id<"humanEvents">[], ignoredEventIds: diff.ignoredEventIds as Id<"humanEvents">[] });
  return { token, deadlineAt: Date.now() + 240_000 };
} });
export const contexts = internalQuery({ args: { askId: v.id("asks") }, returns: v.any(), handler: async (ctx, { askId }) => {
  const ask = (await ctx.db.get(askId))!, data = await answerData(ctx, ask), history = await historicalCases(ctx, ask.ns), diffs = await ctx.db.query("traceDiffs").withIndex("by_ask", q => q.eq("ns", ask.ns).eq("askId", askId)).collect();
  const out = [];
  for (const row of diffs.filter(diff => diff.type !== "CONFIRMATION")) {
    const diff: TraceDiff = { type: row.type, agentSide: row.agentSide as Record<string, unknown>, humanSide: row.humanSide as Record<string, unknown>, provenanceEventIds: row.provenanceEventIds.map(String), ignoredEventIds: row.ignoredEventIds.map(String), humanEvidence: row.origin === "HUMAN" };
    const lesson = await ctx.db.query("lessons").withIndex("by_diff", q => q.eq("ns", ask.ns).eq("traceDiffId", row._id)).unique();
    const memory = lesson ? await ctx.db.query("memoryItems").withIndex("by_ns", q => q.eq("ns", ask.ns)).filter(q => q.eq(q.field("lessonId"), lesson._id)).first() : null;
    const context: LessonContext = { diff, caseCode: data.b.case.code, role: ask.role, formCode: data.b.charter.formCode, portCode: data.b.port.code, counterpartyCode: data.b.cargoParty.code, history: precedentSearch(diff, data.b.charter.formCode, history), amountAtRiskCents: ask.amountAtRiskCents ?? 0 };
    const failedDraft = !!(lesson?.lessonJson as { draft_error?: string } | undefined)?.draft_error;
    out.push({ diffId: row._id, context, done: !!memory && !(memory.status === "NEEDS_REVIEW" && failedDraft), lessonId: failedDraft ? null : lesson?._id ?? null });
  }
  return out;
} });
async function leased(ctx: Parameters<typeof loadPolicies>[0], askId: Id<"asks">, token: string) {
  const ask = await ctx.db.get(askId); if (!ask) throw Error("Learning source missing");
  const run = await ctx.db.query("learningRuns").withIndex("by_ask", q => q.eq("ns", ask.ns).eq("askId", askId)).unique();
  if (!run || run.leaseToken !== token || run.state !== "RUNNING" || run.leaseUntil < Date.now()) throw Error("Learning lease expired");
  return { ask, run };
}
export const storeLesson = internalMutation({ args: { askId: v.id("asks"), token: v.string(), diffId: v.id("traceDiffs"), context: v.any(), draft: v.any() }, returns: v.id("lessons"), handler: async (ctx, { askId, token, diffId, context: raw, draft: response }) => {
  const { ask } = await leased(ctx, askId, token), context = raw as LessonContext;
  const existing = await ctx.db.query("lessons").withIndex("by_diff", q => q.eq("ns", ask.ns).eq("traceDiffId", diffId)).unique();
  if (existing && !(existing.lessonJson as { draft_error?: string }).draft_error) return existing._id;
  const payload = parseMemoryPayload(response.draft?.proposed_payload), valid = !!payload && payloadConsistent(payload, context);
  const fallback: MemoryPayload = { type: "PRECEDENT", summary: "Lesson draft needs review" };
  const lesson = makeLesson(context, { lesson_text: valid ? String(response.draft.lesson_text) : "Review lesson draft", proposed_payload: valid ? payload! : fallback });
  const values = { ns: ask.ns, origin: context.diff.humanEvidence ? "HUMAN" as const : "AUTOMATED_TEST" as const, traceDiffId: diffId, lessonJson: { ...lesson, ...(valid ? {} : { draft_error: response.error ?? "INVALID_LESSON_PAYLOAD" }) }, payload: lesson.proposed_payload, lessonText: lesson.lesson_text, ...(response.model ? { draftModel: response.model, draftUsage: response.usage } : {}) };
  if (existing) {
    await appendAudit(ctx, { ns: ask.ns, origin: existing.origin, actor: "system:learning-retry", role: "agent", type: "LESSON_DRAFT_RETRIED", entityType: "lesson", entityId: String(existing._id), correlationId: `case:${ask.caseId}`, before: { lesson: existing.lessonJson, model: existing.draftModel ?? null, usage: existing.draftUsage ?? null }, after: { valid }, at: await getSimNow(ctx,ask.ns) });
    await ctx.db.patch(existing._id, values); return existing._id;
  }
  return ctx.db.insert("lessons", values);
} });
export const lessonForClassify = internalQuery({ args: { lessonId: v.id("lessons") }, returns: v.any(), handler: async (ctx, { lessonId }) => {
  const lesson = (await ctx.db.get(lessonId))!, calls = await ctx.db.query("classifierCalls").withIndex("by_lesson", q => q.eq("ns", lesson.ns).eq("lessonId", lessonId)).collect();
  return { lesson: lesson.lessonJson, previous: calls.at(-1) ?? null };
} });
export const finalize = internalMutation({ args: { askId: v.id("asks"), token: v.string(), lessonId: v.id("lessons"), classification: v.any() }, returns: v.string(), handler: async (ctx, { askId, token, lessonId, classification: classified }) => {
  const { ask } = await leased(ctx, askId, token), lesson = (await ctx.db.get(lessonId))!, json = lesson.lessonJson as LessonJson & { draft_error?: string };
  const existingMemory = await ctx.db.query("memoryItems").withIndex("by_ns", q => q.eq("ns", ask.ns)).filter(q => q.eq(q.field("lessonId"), lessonId)).first(); if (existingMemory && !(existingMemory.status === "NEEDS_REVIEW" && existingMemory.gateDecision?.reason === "Lesson draft needs review")) return existingMemory.status;
  const result = classified.result as ClassifierResult | undefined;
  const previousCalls = await ctx.db.query("classifierCalls").withIndex("by_lesson", q => q.eq("ns", ask.ns).eq("lessonId", lessonId)).collect();
  if (!previousCalls.length || previousCalls.at(-1)?.status === "ERROR") await ctx.db.insert("classifierCalls", { ns: ask.ns, origin: lesson.origin, lessonId, provider: classified.provider, model: classified.model, request: json, status: result && !json.draft_error ? "OK" : "ERROR", ...(result && !json.draft_error ? { response: result } : { error: json.draft_error ?? classified.error ?? "CLASSIFIER_UNAVAILABLE" }), latencyMs: classified.latencyMs ?? 0 });
  const gate = decideMemory({ lesson: json, result: json.draft_error ? null : result ?? null, policies: await loadPolicies(ctx, ask.ns) });
  if (json.draft_error) gate.reason = "Lesson draft needs review";
  const items = await ctx.db.query("memoryItems").withIndex("by_ns", q => q.eq("ns", ask.ns)).collect(), proposed = json.proposed_payload;
  let base = proposed.type === "PROCEDURE" ? `P-${proposed.procedure.steps.find(step => step.op === "SEARCH_SOURCE")?.system.replaceAll("_", "-") ?? "SOURCE"}-FIRST` : existingMemory?.code ?? `M-${String(items.filter(item => item.origin !== "HISTORY_IMPORT").length + 1).padStart(4,"0")}`;
  if (items.some(item => item.code === base && item._id !== existingMemory?._id)) base = `${base}-${items.filter(item => item.code.startsWith(base)).length + 1}`;
  const payload: MemoryPayload = gate.status === "PRECEDENT_ONLY" && proposed.type !== "PRECEDENT" ? { type: "PRECEDENT", summary: json.lesson_text } : proposed;
  const kind = payload.type === "PROCEDURE" ? "PROCEDURE" : payload.type === "PRECEDENT" ? "PRECEDENT" : "FACT";
  const values = { ns: ask.ns, origin: lesson.origin, code: base, kind:kind as "PROCEDURE"|"PRECEDENT"|"FACT", status: gate.status, title: lesson.lessonText.slice(0,60), payload, scope: { kind: gate.status === "PRECEDENT_ONLY" ? "THIS_CASE" : result?.scope.choice ?? "THIS_CASE", ...(gate.status === "PRECEDENT_ONLY" ? { value: String(ask.caseId) } : proposed.type === "CONTRACT_RULE_OVERRIDE" ? { value: proposed.formCode } : {}) }, sourceCaseId: ask.caseId, sourceAskId: askId, ...(ask.answeredBy ? { sourcePersonaId: ask.answeredBy } : {}), lessonId, gateDecision: gate, version: 1, usedIn: [], createdAt: await getSimNow(ctx, ask.ns) };
  const memoryId = existingMemory?._id ?? await ctx.db.insert("memoryItems",values);
  if (existingMemory) {
    for (const review of await ctx.db.query("asks").withIndex("by_case",q=>q.eq("ns",ask.ns).eq("caseId",ask.caseId)).collect()) if(review.kind==="APPROVE_MEMORY"&&review.subject===existingMemory.code&&review.status==="OPEN") await ctx.db.patch(review._id,{status:"CANCELLED"});
    await ctx.db.patch(memoryId,values);
  }
  if (gate.status === "PENDING_TEACHBACK") await createTeachBackTx(ctx, memoryId);
  else if (gate.status === "NEEDS_REVIEW") await createAskTx(ctx, { ns: ask.ns, caseId: ask.caseId, need: "MEMORY", subject: base, question: "Review this lesson?", options: [{ id: "APPROVE", label: "Approve" }, { id: "REJECT", label: "Reject", requires: ["REASON"] }], context: { evidence: ask.answer?.evidence ?? [] }, createdAt: await getSimNow(ctx, ask.ns), actor: "agent:learning", role: "agent", correlationId: `case:${ask.caseId}` });
  await appendAudit(ctx, { ns: ask.ns, origin: lesson.origin, actor: "agent:learning", role: "agent", type: "MEMORY_PROPOSED", entityType: "memoryItem", entityId: base, correlationId: `case:${ask.caseId}`, after: { status: gate.status, provider: classified.provider, humanEvidence: lesson.origin === "HUMAN" }, at: await getSimNow(ctx, ask.ns) });
  return gate.status;
} });
export const finish = internalMutation({ args: { askId: v.id("asks"), token: v.string(), error: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, { askId, token, error }) => {
  const { run } = await leased(ctx, askId, token); await ctx.db.patch(run._id, { state: error ? "NEEDS_REVIEW" : "COMPLETE", leaseUntil: 0, updatedAt: Date.now(), error }); return null;
} });
export const processAnswer = internalAction({ args: { askId: v.id("asks") }, returns: v.null(), handler: async (ctx, { askId }): Promise<null> => {
  const claim = await ctx.runMutation(internal.learning.claim, { askId }); if (!claim) return null;
  try {
    const contexts = await ctx.runQuery(internal.learning.contexts, { askId });
    let needsReview = false;
    for (const item of contexts) {
      if (item.done) continue;
      const lessonId: Id<"lessons"> = item.lessonId ?? await ctx.runMutation(internal.learning.storeLesson, { askId, token: claim.token, diffId: item.diffId, context: item.context, draft: await ctx.runAction(internal.node.lessons.build, { context: item.context, deadlineAt: claim.deadlineAt }) });
      const data = await ctx.runQuery(internal.learning.lessonForClassify, { lessonId });
      const classification = data.previous?.status === "OK" ? { provider: data.previous.provider, model: data.previous.model, result: data.previous.response, latencyMs: data.previous.latencyMs } : data.lesson.draft_error ? { provider: "jev", model: "not-called", error: data.lesson.draft_error, latencyMs: 0 } : await ctx.runAction(internal.node.lessons.classify, { lesson: data.lesson });
      const status: string = await ctx.runMutation(internal.learning.finalize, { askId, token: claim.token, lessonId, classification });
      if (status === "NEEDS_REVIEW") needsReview = true;
    }
    await ctx.runMutation(internal.learning.finish, { askId, token: claim.token, ...(needsReview ? { error: "LESSON_REVIEW_REQUIRED" } : {}) });
  } catch { await ctx.runMutation(internal.learning.finish, { askId, token: claim.token, error: "LEARNING_UNAVAILABLE" }); }
  return null;
} });

/** Explicit operator recovery of a failed draft only; financial answers/approvals are never replayed. */
export const retryUnavailable = internalMutation({ args: { askCode:v.string() }, returns:v.null(), handler:async(ctx,{askCode})=>{
  const ask=await ctx.db.query("asks").withIndex("by_code",q=>q.eq("ns","demo").eq("code",askCode)).unique();
  if(!ask) throw Error("Source answer missing");
  const run=await ctx.db.query("learningRuns").withIndex("by_ask",q=>q.eq("ns",ask.ns).eq("askId",ask._id)).unique();
  const contexts=await ctx.db.query("traceDiffs").withIndex("by_ask",q=>q.eq("ns",ask.ns).eq("askId",ask._id)).collect();
  let failed=false;
  for(const diff of contexts){ const lesson=await ctx.db.query("lessons").withIndex("by_diff",q=>q.eq("ns",ask.ns).eq("traceDiffId",diff._id)).unique(); if((lesson?.lessonJson as {draft_error?:string}|undefined)?.draft_error) failed=true; }
  if(run?.state!=="NEEDS_REVIEW"||!failed) throw Error("Only a failed lesson draft can be retried");
  await ctx.db.patch(run._id,{state:"RUNNING",leaseUntil:0,updatedAt:Date.now(),error:undefined});
  await appendAudit(ctx,{ns:ask.ns,origin:"SYSTEM",actor:"system:learning-retry",role:"agent",type:"LEARNING_RETRY_REQUESTED",entityType:"ask",entityId:ask.code,correlationId:`case:${ask.caseId}`,after:{financialWorkReplayed:false},at:await getSimNow(ctx,ask.ns)});
  await ctx.scheduler.runAfter(0,internal.learning.processAnswer,{askId:ask._id});return null;
} });
export const calibration = query({ args: {}, returns: v.any(), handler: async ctx => {
  const runs = await ctx.db.query("calibrationRuns").withIndex("by_ns", q => q.eq("ns", "demo")).collect();
  const view = (row: (typeof runs)[number] | undefined) => row ? { provider: row.provider, model: row.model, ranAt: row.ranAt, total: row.total, correct: row.correct } : null;
  return { label: (process.env.BREAKWATER_JEV_TRANSPORT === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.TYPESAFE_API_KEY) ? "Jev" : "Jev unavailable", jev: view(runs.filter(run => run.provider === "jev").sort((a,b) => b.ranAt-a.ranAt)[0]) };
} });

export const saveCalibration = internalMutation({ args: { provider: v.literal("jev"), model: v.string(), total: v.number(), correct: v.number(), perItem: v.any() }, returns: v.null(), handler: async (ctx, input) => {
  await ctx.db.insert("calibrationRuns", { ns: "demo", origin: "SYSTEM", ...input, ranAt: Date.now() }); return null;
} });

export const calibrationEvidence = internalQuery({args:{},returns:v.any(),handler:async ctx=>{
  const rows=await ctx.db.query("calibrationRuns").withIndex("by_ns",q=>q.eq("ns","demo")).collect();
  const row=rows.filter(row=>row.provider==="jev").sort((a,b)=>b.ranAt-a.ranAt)[0];
  return row?{provider:row.provider,model:row.model,ranAt:row.ranAt,total:row.total,correct:row.correct,perItem:row.perItem}:null;
}});

/** Sanitized persisted read-back for acceptance; no leases, secrets or model thinking. */
export const evidence = internalQuery({ args: { since: v.number() }, returns: v.any(), handler: async (ctx, { since }) => {
  const cases = await ctx.db.query("cases").withIndex("by_ns", q=>q.eq("ns","demo")).collect();
  const asks = await ctx.db.query("asks").withIndex("by_ns", q=>q.eq("ns","demo")).collect();
  const lessons = (await ctx.db.query("lessons").withIndex("by_ns", q=>q.eq("ns","demo")).collect()).filter(row=>row._creationTime>=since);
  const calls = await ctx.db.query("classifierCalls").withIndex("by_ns", q=>q.eq("ns","demo")).collect();
  const items = (await ctx.db.query("memoryItems").withIndex("by_ns", q=>q.eq("ns","demo")).collect()).filter(row=>row._creationTime>=since);
  const memories = [];
  for (const item of items) { const backtest = item.backtestId ? await ctx.db.get(item.backtestId) : null; memories.push({ code:item.code,kind:item.kind,status:item.status,origin:item.origin,payload:item.payload,sourceCase:cases.find(c=>c._id===item.sourceCaseId)?.code,sourceAsk:asks.find(ask=>ask._id===item.sourceAskId)?.code,approved:!!item.approvedBy,usedIn:item.usedIn.map(id=>cases.find(c=>c._id===id)?.code),backtest:backtest?{consistent:backtest.consistent,total:backtest.total,cases:backtest.cases}:null }); }
  const jobs = (await ctx.db.query("learningRuns").withIndex("by_ns", q=>q.eq("ns","demo")).collect()).filter(row=>row._creationTime>=since);
  return { memories, jobs:jobs.map(row=>({sourceAsk:asks.find(ask=>ask._id===row.askId)?.code,state:row.state,error:row.error??null})), lessons:lessons.map(row=>({text:row.lessonText,origin:row.origin,model:row.draftModel??null,usage:row.draftUsage??null,payload:row.payload,classifier:calls.filter(call=>call.lessonId===row._id).map(call=>({provider:call.provider,model:call.model,status:call.status,response:call.response??null,error:call.error??null}))})) };
} });

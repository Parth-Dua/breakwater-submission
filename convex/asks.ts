import { internal } from "./_generated/api";
import { answerGovernanceTx } from "./memory";
import { lineId } from "../src/domain/laytime";
import { canonicalJson } from "../src/domain/canonical";
// Ask answers and reminders (CONTRACTS §8). `applyAnswerTx` is the single answer path: the V09 persona mutation
// `asks.answer` and the scripted responder (tests, live smoke, demo prepare) both call it.
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { appendAudit } from "./lib/audit";
import { getSimNow } from "./lib/clock";
import { fail } from "./lib/errors";
import { personaByCode } from "./lib/persona";
import { askAnswer, evidenceRef } from "./lib/validators";
import { automationArg, askForHuman, eventsFor, humanOrigin, linkedEvidence, recordHuman, startHuman, validatedDocumentEvidence } from "./human";
import { applyDraftEdits } from "./statements";
import { currentFacts, intervalFacts } from "./agent/state";
import { enqueueAskAnswered } from "./orchestrator";
import { resumeIfPossible } from "./sim";
import type { Infer } from "convex/values";

const DAY = 86_400_000;
const REMINDER_AFTER_MS = 7 * DAY;

export async function applyAnswerTx(ctx: MutationCtx, input: { ask: Doc<"asks">; answer: Infer<typeof askAnswer>; persona: Doc<"personas">; origin: Doc<"asks">["origin"]; at: number }) {
  const { ask, answer, persona } = input;
  if (ask.status !== "OPEN") fail("STALE_VERSION", "This ask was already answered");
  if (persona.role !== ask.role) fail("WRONG_ROLE", `This ask is for ${ask.role}`);
  const option = ask.options.find(candidate => candidate.id === answer.optionId);
  if (!option) fail("NOT_PERMITTED", "Unknown option");
  for (const need of option.requires ?? []) {
    if (need === "AMOUNT" && !(Number.isSafeInteger(answer.amountCents) && (answer.amountCents ?? -1) >= 0)) fail("NOT_PERMITTED", "An amount is required");
    if (need === "REASON" && !answer.reason?.trim()) fail("NOT_PERMITTED", "A reason is required");
    if (need === "EVIDENCE" && !answer.evidence?.length) fail("MISSING_EVIDENCE", "Link the evidence you used");
  }
  if (answer.amountCents !== undefined && (!Number.isSafeInteger(answer.amountCents) || answer.amountCents < 0 || answer.amountCents > (ask.amountAtRiskCents ?? 0))) fail("NOT_PERMITTED", "The decision amount must be within the computed claim");
  await ctx.db.patch(ask._id, { status: "ANSWERED", answer, answeredBy: persona._id, answeredAt: input.at });
  // A confirmed fact is a human-established fact: the unverified interval named by the ask's subject becomes verified.
  if (ask.kind === "CONFIRM_FACT" && (answer.optionId === "CONFIRM" || answer.optionId === "DIFFERENT" && answer.causeKind)) {
    const facts = await currentFacts(ctx, ask.ns, ask.caseId);
    for (const interval of intervalFacts(facts).filter(candidate => candidate.kind === ask.subject && !candidate.verified)) {
      const { factId, ...value } = interval;
      const id = await ctx.db.insert("facts", { ns: ask.ns, origin: input.origin, caseId: ask.caseId, key: "INTERVAL", value: { ...value, ...(answer.optionId === "DIFFERENT" ? { kind: answer.causeKind, note: answer.reason } : {}), verified: true, source: "HUMAN" }, evidence: answer.evidence ?? [], establishedBy: "HUMAN", at: input.at });
      await ctx.db.patch(factId, { supersededBy: id });
    }
  }
  const item = (await ctx.db.get(ask.caseId))!;
  await ctx.db.patch(ask.caseId, { status: "WORKING", statusLine: "Applying answer", updatedAt: Date.now() });
  await appendAudit(ctx, { ns: ask.ns, origin: input.origin, actor: `persona:${persona.code}`, role: persona.role, type: "ASK_ANSWERED", entityType: "ask", entityId: ask.code, correlationId: item.correlationId, after: { optionId: answer.optionId, ...(answer.amountCents !== undefined ? { amountCents: answer.amountCents } : {}), ...(answer.reason ? { reason: answer.reason } : {}) }, ...(answer.evidence?.length ? { evidence: answer.evidence } : {}), at: input.at });
  const taskId = await enqueueAskAnswered(ctx, ask);
  await resumeIfPossible(ctx, ask.ns); // a held clock resumes; it still waits while the agent applies the answer
  return taskId;
}

const PERSONA_FOR_ROLE = { ops: "OPS", controller: "CONTROLLER", trader: "TRADER" } as const;

/** Scripted responder (origin SCRIPTED_RESPONDER): answers as the ask's role persona. Tests, live smoke and prepare only. */
export const respondScripted = internalMutation({
  args: { ns: v.string(), askCode: v.string(), answer: askAnswer },
  returns: v.id("agentTasks"),
  handler: async (ctx, { ns, askCode, answer }): Promise<Id<"agentTasks">> => {
    const ask = await ctx.db.query("asks").withIndex("by_code", q => q.eq("ns", ns).eq("code", askCode)).unique();
    if (!ask) fail("NOT_PERMITTED", "Unknown ask");
    const code = PERSONA_FOR_ROLE[ask.role as keyof typeof PERSONA_FOR_ROLE];
    const persona = code ? await personaByCode(ctx, code, ns) : null;
    if (!persona) fail("NOT_PERMITTED", "No persona for this role");
    return applyAnswerTx(ctx, { ask, answer, persona, origin: "SCRIPTED_RESPONDER", at: await getSimNow(ctx, ns) });
  },
});

/** Reminders for asks open longer than 7 sim days (one per 7 days; audit ASK_REMINDER_SENT at the due sim time). */
export async function sendDueReminders(ctx: MutationCtx, ns: string, simNow: number) {
  const open = await ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", ns)).filter(q => q.eq(q.field("status"), "OPEN")).collect();
  for (const ask of open) {
    let sent = ask.remindersSent;
    while (ask.createdAt + REMINDER_AFTER_MS * (sent + 1) <= simNow) {
      sent++;
      const item = await ctx.db.get(ask.caseId);
      await appendAudit(ctx, { ns, origin: "SYSTEM", actor: "system:reminders", role: "agent", type: "ASK_REMINDER_SENT", entityType: "ask", entityId: ask.code, correlationId: item?.correlationId ?? `ask:${ask.code}`, details: { reminder: sent, role: ask.role }, at: ask.createdAt + REMINDER_AFTER_MS * sent });
    }
    if (sent !== ask.remindersSent) await ctx.db.patch(ask._id, { remindersSent: sent });
  }
}


export const linkEvidence = mutation({ args: { askCode: v.string(), evidence: evidenceRef, ...automationArg }, returns: v.null(), handler: async (ctx, { askCode, evidence, automation }) => {
  const { ask, acting } = await askForHuman(ctx, askCode, ["CONFIRM_FACT"]);
  await validatedDocumentEvidence(ctx, ask, acting, evidence);
  await startHuman(ctx, ask, acting, automation);
  const target = intervalFacts(await currentFacts(ctx, ask.ns, ask.caseId)).find(interval => interval.kind === ask.subject);
  if (!linkedEvidence(await eventsFor(ctx, ask), acting.persona._id).some(ref => canonicalJson(ref) === canonicalJson(evidence))) await recordHuman(ctx, ask, acting, "EVIDENCE_LINKED", { evidence, linkedTo: target ? lineId(ask.subject, target.startAt) : ask.subject }, automation);
  return null;
} });
export const unlinkEvidence = mutation({ args: { askCode: v.string(), evidence: evidenceRef, ...automationArg }, returns: v.null(), handler: async (ctx, { askCode, evidence, automation }) => {
  const { ask, acting } = await askForHuman(ctx, askCode, ["CONFIRM_FACT"]);
  if (linkedEvidence(await eventsFor(ctx, ask), acting.persona._id).some(ref => canonicalJson(ref) === canonicalJson(evidence))) await recordHuman(ctx, ask, acting, "EVIDENCE_UNLINKED", { evidence }, automation);
  return null;
} });
export const answer = mutation({
  args: { askCode: v.string(), answer: askAnswer, expectedVersion: v.optional(v.number()), ...automationArg }, returns: v.null(),
  handler: async (ctx, { askCode, answer, expectedVersion, automation }) => {
    const { ask, acting, bundle } = await askForHuman(ctx, askCode, ["CONFIRM_FACT", "PAYMENT_APPROVAL", "COMMERCIAL_DECISION", "TEACH_BACK", "APPROVE_MEMORY"]);
    if (ask.kind === "TEACH_BACK" || ask.kind === "APPROVE_MEMORY") { await answerGovernanceTx(ctx, { ask, acting, optionId: answer.optionId, reason: answer.reason, automation }); return null; }
    if (answer.reason && (!answer.reason.trim() || answer.reason.length > 240)) fail("NOT_PERMITTED", "Use a reason of at most 240 characters");
    await startHuman(ctx, ask, acting, automation);
    const events = await eventsFor(ctx, ask), linked = linkedEvidence(events, acting.persona._id);
    if (ask.kind === "CONFIRM_FACT") {
      for (const ref of answer.evidence ?? []) {
        if (!linked.some(candidate => canonicalJson(candidate) === canonicalJson(ref))) fail("MISSING_EVIDENCE", "Submit the evidence you linked");
        await validatedDocumentEvidence(ctx, ask, acting, ref);
      }
      if (answer.optionId === "DIFFERENT" && (!answer.causeKind || !["WEATHER", "PORT_CLOSURE", "SHIFTING", "OPERATIONS"].includes(answer.causeKind))) fail("MISSING_EVIDENCE", "Choose the different cause");
      if (answer.optionId === "CONFIRM") {
        const holds = intervalFacts(await currentFacts(ctx, ask.ns, ask.caseId)).filter(interval => interval.kind === ask.subject && !interval.verified);
        const records = await ctx.db.query("customsRecords").withIndex("by_port_vessel", q => q.eq("ns", ask.ns).eq("portId", bundle.port._id).eq("vesselId", bundle.vessel._id)).collect();
        for (const hold of holds) {
          let covered = false;
          for (const record of records.filter(record => record.kind === "RELEASE" && record.startAt <= hold.startAt && (record.endAt ?? 0) >= hold.endAt)) {
            const document = await ctx.db.get(record.documentId);
            if (document && (answer.evidence ?? []).some(ref => ref.kind === "DOC" && ref.documentId === document.code)) covered = true;
          }
          if (!covered) fail("MISSING_EVIDENCE", "Link an authority release covering this vessel and hold");
        }
      }
    } else if (answer.evidence?.length) fail("NOT_PERMITTED", "This decision does not accept source links");
    if (ask.kind === "PAYMENT_APPROVAL") await applyDraftEdits(ctx, ask, acting.persona._id, answer.editIds ?? [], expectedVersion, answer.optionId === "APPROVE", automation);
    else if (answer.editIds?.length) fail("NOT_PERMITTED", "This ask does not accept statement edits");
    await recordHuman(ctx, ask, acting, "ANSWER_SUBMITTED", { ...answer, ...(expectedVersion !== undefined ? { statementVersion: expectedVersion } : {}) }, automation);
    const latest = (await ctx.db.get(ask._id))!;
    await applyAnswerTx(ctx, { ask: latest, answer, persona: acting.persona, origin: humanOrigin(automation), at: await getSimNow(ctx, ask.ns) });
    await ctx.scheduler.runAfter(0, internal.learning.processAnswer, { askId: ask._id });
    const observer = await personaByCode(ctx, "OBSERVER", ask.ns);
    if (observer) await ctx.db.patch(acting.sessionId, { actingPersonaId: observer._id, updatedAt: Date.now() });
    return null;
  },
});

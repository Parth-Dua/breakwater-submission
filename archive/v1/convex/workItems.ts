import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import schema from "./schema";
import { finding } from "./validators";
import { requireReader } from "./access";
import { currentScenario } from "./workspace";
import { accessWork, ownedSession, sourceForWork, observe, materialAudit, closeSession } from "./internal/observation";
import { getClaimCalculation } from "./financeCore";
import { intervalMinutes } from "../src/domain/intervals";
import { overlapMinutes } from "../src/lib/trajectory";
import { financialIntervals } from "../src/domain/claim-timeline";

export const listForCurrentRole = query({ args: {}, returns: v.array(v.object({ work: schema.doc("workItems"), voyageCode: v.string(), vesselName: v.string(), candidateCode:v.optional(v.string()) })), handler: async ctx => {
  const actor = await requireReader(ctx), scenario = await currentScenario(ctx); if (!scenario) return [];
  const records = await ctx.db.query("workItems").withIndex("by_scenario", q => q.eq("scenarioId", scenario._id)).collect();
  return Promise.all(records.filter(work => work.assignedRole === actor.role || ["auditor", "demo_admin"].includes(actor.role)).sort((a, b) => b.updatedAt - a.updatedAt).map(async work => { const claim = await ctx.db.get(work.claimId), voyage = claim ? await ctx.db.get(claim.voyageId) : null, vessel = voyage ? await ctx.db.get(voyage.vesselId) : null; if (!voyage || !vessel) throw new Error("Review source integrity failure"); const candidate=work.candidateId?await ctx.db.get(work.candidateId):null; return { work, voyageCode: voyage.voyageCode, vesselName: vessel.name, candidateCode:candidate?.candidateCode }; }));
} });
export const get = query({ args: { workItemId: v.id("workItems") }, returns: v.object({ work: schema.doc("workItems"), claim: schema.doc("claims"), voyageCode: v.string(), vesselName: v.string(), evidence: v.array(schema.doc("evidence")), session: v.union(v.null(), schema.doc("workSessions")), events: v.array(schema.doc("actionEvents")), checks: v.array(v.object({ tool: v.string(), status: v.string() })) }), handler: async (ctx, args) => {
  const { actor, work, claim } = await accessWork(ctx, args.workItemId), voyage = await ctx.db.get(claim.voyageId), vessel = voyage ? await ctx.db.get(voyage.vesselId) : null;
  if (!voyage || !vessel) throw new Error("Review source integrity failure");
  const sessions = await ctx.db.query("workSessions").withIndex("by_work_item", q => q.eq("workItemId", work._id)).collect();
  const session = sessions.filter(session => session.actorId === actor._id).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
  const events = session ? await ctx.db.query("actionEvents").withIndex("by_session_sequence", q => q.eq("sessionId", session._id)).collect() : [];
  const runs = await ctx.db.query("agentRuns").withIndex("by_claim", q => q.eq("claimId", claim._id)).collect(), evidence = await Promise.all(work.evidenceIds.map(id => sourceForWork(ctx, work, id)));
  return { work, claim, voyageCode: voyage.voyageCode, vesselName: vessel.name, evidence, session, events, checks: runs.find(run => run.correlationId === work.correlationId)?.toolOutcomes.map(({ tool, status }) => ({ tool, status })) ?? [] };
} });
export const claimTask = mutation({ args: { workItemId: v.id("workItems") }, returns: v.id("workSessions"), handler: async (ctx, args) => {
  const { actor, work, claim } = await accessWork(ctx, args.workItemId, true); if (work.type !== "OPS_FACT") throw new Error("Operations fact review required");
  if (work.claimRevision !== undefined && work.claimRevision !== claim.revision) throw new Error("Review revision is stale");
  if (work.status === "CLAIMED" && work.claimedBy !== actor._id) throw new Error("Review already claimed by another reviewer");
  if (!["OPEN", "CLAIMED", "WAITING_INFORMATION"].includes(work.status)) throw new Error("Review is closed");
  const sessions = await ctx.db.query("workSessions").withIndex("by_work_item", q => q.eq("workItemId", work._id)).collect(), existing = sessions.find(session => session.actorId === actor._id && session.status === "OPEN");
  if (existing) return existing._id;
  const id = await ctx.db.insert("workSessions", { scenarioId: work.scenarioId, synthetic: true, workItemId: work._id, actorId: actor._id, startedAt: Date.now(), status: "OPEN", nextSequence: 0, captureOrigin: actor.automationOnly ? "AUTOMATED_TEST" : "APPLICATION_UI" });
  await ctx.db.patch(work._id, { status: "CLAIMED", claimedBy: actor._id, updatedAt: Date.now() });
  const session = (await ctx.db.get(id))!;
  await observe(ctx, session, actor, work, "WORK_SESSION_STARTED", { workItemId: work._id, claimId: claim._id, captureOrigin: session.captureOrigin });
  await materialAudit(ctx, actor, work, "WORK_ITEM_CLAIMED", { sessionId: id, captureOrigin: session.captureOrigin }); return id;
} });
export const searchArchive = mutation({ args: { sessionId: v.id("workSessions"), search: v.string() }, returns: v.array(schema.doc("evidence")), handler: async (ctx, args) => {
  const { session, actor, work, claim } = await ownedSession(ctx, args.sessionId), search = args.search.trim().toLowerCase(); if (search.length > 120) throw new Error("Search is too long");
  const sources = await ctx.db.query("evidence").withIndex("by_voyage_type", q => q.eq("voyageId", claim.voyageId)).collect();
  const results = sources.filter(source => source.scenarioId === work.scenarioId && source.visibility === "OPS_ARCHIVE" && source.withdrawnAt===undefined && (!search || `${source.evidenceCode} ${source.type} ${source.content}`.toLowerCase().includes(search)));
  await observe(ctx, session, actor, work, "ARCHIVE_SEARCHED", { search, resultIds: results.map(source => source._id), repository: "OPS_ARCHIVE", voyageId: claim.voyageId }, true); return results;
} });
const viewEvent = v.union(v.object({ type: v.literal("EVIDENCE_OPENED"), evidenceId: v.id("evidence") }), v.object({ type: v.literal("TIMELINE_RANGE_SELECTED"), startAt: v.number(), endAt: v.number() }));
export const recordObservation = mutation({ args: { sessionId: v.id("workSessions"), event: viewEvent }, returns: v.id("actionEvents"), handler: async (ctx, args) => {
  const { session, actor, work, claim } = await ownedSession(ctx, args.sessionId);
  if (args.event.type === "EVIDENCE_OPENED") { const source = await sourceForWork(ctx, work, args.event.evidenceId); return observe(ctx, session, actor, work, "EVIDENCE_OPENED", { evidenceId: source._id, evidenceType: source.type, observedAction: "DOCUMENT_OPENED", assertsConclusion: false }, true); }
  const range = { startAt: args.event.startAt, endAt: args.event.endAt }; intervalMinutes(range);
  const data = await getClaimCalculation(ctx, claim._id), points = await ctx.db.query("aisPoints").withIndex("by_voyage_at", q => q.eq("voyageId", claim.voyageId)).collect();
  if (!points.length || range.startAt < points[0].at || range.endAt > points[points.length - 1].at) throw new Error("Selection outside observed timeline");
  const windows = financialIntervals(data.voyage, data.segments, { version: data.charter.version, ...data.charter.terms });
  return observe(ctx, session, actor, work, "TIMELINE_RANGE_SELECTED", { ...range, claimedMinutes: overlapMinutes(range, [data.voyage]), evidencedMinutes: overlapMinutes(range, windows.filter(window => window.treatment !== "UNVERIFIED")) }, true);
} });
export const compareEvidence = mutation({ args: { sessionId: v.id("workSessions"), evidenceId: v.id("evidence") }, returns: v.object({ sameVoyage: v.literal(true), signed: v.boolean(), coveredMinutes: v.number(), requiredMinutes: v.number(), completeCoverage: v.boolean(), cause: v.string() }), handler: async (ctx, args) => {
  const { session, actor, work } = await ownedSession(ctx, args.sessionId), source = await sourceForWork(ctx, work, args.evidenceId), windows = work.affectedIntervals ?? [];
  const requiredMinutes = windows.reduce((sum, window) => sum + intervalMinutes(window), 0), coveredMinutes = windows.reduce((sum, window) => sum + overlapMinutes(window, [source]), 0);
  const result = { sameVoyage: true as const, signed: source.signedStatus === "SYNTHETIC_SIGNED"&&source.withdrawnAt===undefined, coveredMinutes, requiredMinutes, completeCoverage: requiredMinutes > 0 && coveredMinutes === requiredMinutes, cause: source.cause ?? "UNKNOWN" };
  await observe(ctx, session, actor, work, "EVIDENCE_COMPARED", { evidenceId: source._id, ...result, assertsHumanConclusion: false }); return result;
} });
export const linkEvidence = mutation({ args: { sessionId: v.id("workSessions"), evidenceId: v.id("evidence") }, returns: v.id("workItems"), handler: async (ctx, args) => {
  const { session, actor, work } = await ownedSession(ctx, args.sessionId), source = await sourceForWork(ctx, work, args.evidenceId);
  if (source.type !== "SIGNED_OPS_LOG" || (source.signedStatus !== "SYNTHETIC_SIGNED"||source.withdrawnAt!==undefined) || !source.cause || source.cause === "UNKNOWN") throw new Error("Signed Operations log with explicit cause required");
  if (!(work.affectedIntervals ?? []).some(window => overlapMinutes(window, [source]) > 0)) throw new Error("Source does not cover the review interval");
  if (work.evidenceIds.includes(source._id)) return work._id;
  await ctx.db.patch(work._id, { evidenceIds: [...work.evidenceIds, source._id], updatedAt: Date.now() });
  await observe(ctx, session, actor, work, "EVIDENCE_LINKED", { evidenceId: source._id, voyageId: source.voyageId, linkPurpose: "REVIEW_PENDING_FINDING" });
  await materialAudit(ctx, actor, work, "REVIEW_EVIDENCE_LINKED", { evidenceId: source._id, sessionId: session._id }); return work._id;
} });
async function validateFinding(ctx: Parameters<typeof ownedSession>[0], work: Doc<"workItems">, value: Doc<"workItems">["finding"]) {
  if (!value || value.note.trim().length < 3 || value.note.length > 2000) throw new Error("A concise finding note is required"); intervalMinutes(value);
  const windows = work.affectedIntervals ?? []; if (!windows.length || value.startAt !== windows[0].startAt || value.endAt !== windows[windows.length - 1].endAt) throw new Error("Finding must address the requested interval");
  if (value.unavailable) { if (value.cause !== "UNKNOWN" || value.evidenceIds.length) throw new Error("Unavailable evidence cannot assert a verified cause"); return; }
  if (value.cause === "UNKNOWN" || !value.evidenceIds.length) throw new Error("Final cause requires linked source evidence");
  const sources = await Promise.all(value.evidenceIds.map(async id => { if (!work.evidenceIds.includes(id)) throw new Error("Link the evidence before submitting a finding"); const source = await sourceForWork(ctx, work, id); if (source.type !== "SIGNED_OPS_LOG" || (source.signedStatus !== "SYNTHETIC_SIGNED"||source.withdrawnAt!==undefined) || source.cause !== value.cause) throw new Error("Finding cause differs from signed same-voyage evidence"); return source; }));
  if (overlapMinutes(value, sources) !== intervalMinutes(value)) throw new Error("Signed sources do not cover the complete finding interval");
}
export const saveFinding = mutation({ args: { sessionId: v.id("workSessions"), finding }, returns: v.null(), handler: async (ctx, args) => {
  const { session, actor, work } = await ownedSession(ctx, args.sessionId); await validateFinding(ctx, work, args.finding);
  const corrected = !!work.finding && JSON.stringify(work.finding) !== JSON.stringify(args.finding);
  await ctx.db.patch(work._id, { finding: args.finding, updatedAt: Date.now() });
  await observe(ctx, session, actor, work, corrected ? "DECISION_CORRECTED" : "FINDING_EDITED", { cause: args.finding.cause, startAt: args.finding.startAt, endAt: args.finding.endAt, evidenceIds: args.finding.evidenceIds, note: args.finding.note, unavailable: args.finding.unavailable, status: "DRAFT" });
  await materialAudit(ctx, actor, work, corrected ? "REVIEW_DRAFT_CORRECTED" : "REVIEW_DRAFT_SAVED", { sessionId: session._id }); return null;
} });
export const submitFinding = mutation({ args: { sessionId: v.id("workSessions"), finding }, returns: v.id("workItems"), handler: async (ctx, args) => {
  const { session, actor, work, claim } = await ownedSession(ctx, args.sessionId, true), key = JSON.stringify(args.finding);
  if (session.status === "COMPLETED") { if (session.submissionKey === key) return work._id; throw new Error("Submitted session is immutable"); }
  if (work.status !== "CLAIMED" || work.claimedBy !== actor._id || (work.claimRevision !== undefined && work.claimRevision !== claim.revision)) throw new Error("Review is closed or stale");
  await validateFinding(ctx, work, args.finding);
  if (!args.finding.unavailable) {
    await ctx.db.patch(claim._id, { evidenceIds: [...new Set([...claim.evidenceIds, ...args.finding.evidenceIds])], revision: claim.revision + 1, status: "INVESTIGATING", updatedAt: Date.now() });
    const data = await getClaimCalculation(ctx, claim._id); await ctx.db.patch(claim._id, { supportedCents: data.calculation.supportedCents, disputedCents: data.calculation.disputedCents, unverifiedCents: data.calculation.unverifiedCents });
    await ctx.db.patch(work._id, { status: "SUBMITTED", finding: args.finding, updatedAt: Date.now() });
  } else { await ctx.db.patch(work._id, { status: "WAITING_INFORMATION", finding: args.finding, updatedAt: Date.now() }); await ctx.db.patch(claim._id, { status: "ON_HOLD", updatedAt: Date.now() }); }
  await observe(ctx, session, actor, work, "FINDING_SUBMITTED", { cause: args.finding.cause, startAt: args.finding.startAt, endAt: args.finding.endAt, evidenceIds: args.finding.evidenceIds, note: args.finding.note, unavailable: args.finding.unavailable });
  await materialAudit(ctx, actor, work, "OPERATIONS_FINDING_SUBMITTED", { sessionId: session._id, cause: args.finding.cause, evidenceIds: args.finding.evidenceIds, captureOrigin: session.captureOrigin });
  await ctx.db.patch(session._id, { submissionKey: key }); await closeSession(ctx, session, actor, work, args.finding.unavailable ? "EVIDENCE_UNAVAILABLE" : "FINDING_SUBMITTED");
  if (!args.finding.unavailable) await ctx.scheduler.runAfter(0, internal.internal.observation.resume, { sessionId: session._id });
  return work._id;
} });
export const requestClarification = mutation({ args: { sessionId: v.id("workSessions"), note: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const { session, actor, work, claim } = await ownedSession(ctx, args.sessionId); if (args.note.trim().length < 3 || args.note.length > 2000) throw new Error("Clarification question required");
  await ctx.db.patch(work._id, { status: "WAITING_INFORMATION", clarification: args.note.trim(), updatedAt: Date.now() }); await ctx.db.patch(claim._id, { status: "ON_HOLD", updatedAt: Date.now() });
  await materialAudit(ctx, actor, work, "CLARIFICATION_REQUESTED", { note: args.note.trim(), sessionId: session._id }); await closeSession(ctx, session, actor, work, "CLARIFICATION_REQUESTED"); return null;
} });
export const reassign = mutation({ args: { sessionId: v.id("workSessions") }, returns: v.null(), handler: async (ctx, args) => {
  const { session, actor, work } = await ownedSession(ctx, args.sessionId); await ctx.db.patch(work._id, { status: "OPEN", claimedBy: undefined, updatedAt: Date.now() });
  await materialAudit(ctx, actor, work, "RETURNED_TO_OPERATIONS_QUEUE", { sessionId: session._id }); await closeSession(ctx, session, actor, work, "RETURNED_TO_QUEUE"); return null;
} });

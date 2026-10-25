import { internalMutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireReader, requireRole } from "../access";
import { currentScenario } from "../workspace";
import { enqueueLearning } from "./learningStore";
import { startRun } from "./workflow";
import { v } from "convex/values";
type Payload = Record<string, string | number | boolean | null | string[]>;
const payloadKey = (payload: Payload) => JSON.stringify(Object.keys(payload).sort().map(key => [key, payload[key]]));
export async function accessWork(ctx: QueryCtx, workItemId: Id<"workItems">, write = false) {
  const actor = write ? await requireRole(ctx, ["operations_reviewer"]) : await requireReader(ctx);
  const work = await ctx.db.get(workItemId), scenario = await currentScenario(ctx);
  if (!work || work.scenarioId !== scenario?._id) throw new Error("Review outside authorized workspace");
  if (work.assignedRole !== actor.role && !(!write && ["auditor", "demo_admin"].includes(actor.role))) throw new Error("Review assigned to another role");
  const claim = await ctx.db.get(work.claimId); if (!claim || claim.scenarioId !== work.scenarioId) throw new Error("Review claim integrity failure");
  return { actor, work, claim };
}
export async function ownedSession(ctx: QueryCtx, sessionId: Id<"workSessions">, allowClosed = false) {
  const session = await ctx.db.get(sessionId); if (!session) throw new Error("Work session not found");
  const context = await accessWork(ctx, session.workItemId, true);
  if (session.actorId !== context.actor._id || session.scenarioId !== context.work.scenarioId) throw new Error("Session belongs to another reviewer");
  if (!allowClosed && (session.status !== "OPEN" || context.work.claimedBy !== context.actor._id || context.work.status !== "CLAIMED")) throw new Error("Work session is closed or no longer assigned");
  if (context.work.type !== "OPS_FACT") throw new Error("Operations fact review required");
  return { ...context, session };
}
export async function sourceForWork(ctx: QueryCtx, work: Doc<"workItems">, evidenceId: Id<"evidence">) {
  const claim = await ctx.db.get(work.claimId), source = await ctx.db.get(evidenceId);
  if (!claim || !source || source.voyageId !== claim.voyageId || source.scenarioId !== work.scenarioId) throw new Error("Source must belong to the same voyage and workspace");
  return source;
}
export async function observe(ctx: MutationCtx, session: Doc<"workSessions">, actor: Doc<"users">, work: Doc<"workItems">, eventType: Doc<"actionEvents">["eventType"], payload: Payload, throttle = false) {
  if (throttle) {
    const recent = await ctx.db.query("actionEvents").withIndex("by_session_sequence", q => q.eq("sessionId", session._id)).order("desc").take(20);
    const duplicate = recent.find(event => event.eventType === eventType && payloadKey(event.payload) === payloadKey(payload) && Date.now() - event.at < 1000);
    if (duplicate) return duplicate._id;
  }
  const fresh = await ctx.db.get(session._id); if (!fresh || fresh.status !== "OPEN") throw new Error("Cannot append to a closed observation session");
  const id = await ctx.db.insert("actionEvents", { scenarioId: work.scenarioId, synthetic: true, sessionId: session._id, actorId: actor._id, actorRole: actor.role, eventType, at: Date.now(), sequence: fresh.nextSequence, payload, correlationId: work.correlationId });
  await ctx.db.patch(session._id, { nextSequence: fresh.nextSequence + 1 }); return id;
}
export async function materialAudit(ctx: MutationCtx, actor: Doc<"users">, work: Doc<"workItems">, eventType: string, details: Payload) {
  const fresh=await ctx.db.get(work._id);
  await ctx.db.insert("auditEvents", { scenarioId: work.scenarioId, synthetic: true, actor: actor._id, actorRole:actor.role, eventType, entityType: "workItem", entityId: work._id, correlationId: work.correlationId, at: Date.now(), details:{beforeState:work.status,afterState:fresh?.status??"MISSING",...details} });
}
export async function closeSession(ctx: MutationCtx, session: Doc<"workSessions">, actor: Doc<"users">, work: Doc<"workItems">, reason: string) {
  await observe(ctx, session, actor, work, "WORK_SESSION_COMPLETED", { reason, captureOrigin: session.captureOrigin });
  await ctx.db.patch(session._id, { status: "COMPLETED", endedAt: Date.now() });
  await enqueueLearning(ctx, session._id);
}
export const resume = internalMutation({ args: { sessionId: v.id("workSessions") }, returns: v.union(v.null(), v.id("agentRuns")), handler: async (ctx, args) => {
  const session = await ctx.db.get(args.sessionId), work = session ? await ctx.db.get(session.workItemId) : null;
  if (!session || session.status !== "COMPLETED" || !work || work.status !== "SUBMITTED" || !work.finding || work.finding.unavailable) return null;
  return startRun(ctx, work.claimId);
} });

// Orchestrator (ARCHITECTURE §5.1): released world events → agent tasks. Idempotent per (event, case).
// Tasks run on the real agent when BREAKWATER_AGENT=live (the Convex env); otherwise they stay QUEUED (tests drive them).
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { loadPolicies } from "./gateway";
import { deadlineFallbackDue } from "../src/domain/policy";
import type { MutationCtx } from "./_generated/server";

type TaskKind = Doc<"agentTasks">["kind"];

async function enqueue(ctx: MutationCtx, ns: string, kind: TaskKind, event: Doc<"worldEvents">, caseId?: Id<"cases">) {
  const idempotencyKey = `${event._id}:${caseId ?? kind}`;
  const existing = await ctx.db.query("agentTasks").withIndex("by_idempotency", q => q.eq("ns", ns).eq("idempotencyKey", idempotencyKey)).unique();
  if (existing) return existing._id;
  const now = Date.now();
  const taskId = await ctx.db.insert("agentTasks", { ns, origin: "SYSTEM", kind, triggerEventId: event._id, state: "QUEUED", attempt: 0, idempotencyKey, createdAt: now, updatedAt: now, ...(caseId ? { caseId } : {}) });
  await scheduleTask(ctx, taskId);
  return taskId;
}

export async function scheduleTask(ctx: MutationCtx, taskId: Id<"agentTasks">, delayMs = 0) {
  if (process.env.BREAKWATER_AGENT === "live") await ctx.scheduler.runAfter(delayMs, internal.node.agent.runTask, { taskId });
}

/** ASK_ANSWERED task for the case (one per ask). */
export async function enqueueAskAnswered(ctx: MutationCtx, ask: Doc<"asks">): Promise<Id<"agentTasks">> {
  const idempotencyKey = `ask:${ask._id}`;
  const existing = await ctx.db.query("agentTasks").withIndex("by_idempotency", q => q.eq("ns", ask.ns).eq("idempotencyKey", idempotencyKey)).unique();
  if (existing) return existing._id;
  const now = Date.now();
  const taskId = await ctx.db.insert("agentTasks", { ns: ask.ns, origin: "SYSTEM", kind: "ASK_ANSWERED", caseId: ask.caseId, triggerAskId: ask._id, state: "QUEUED", attempt: 0, idempotencyKey, createdAt: now, updatedAt: now });
  await scheduleTask(ctx, taskId);
  return taskId;
}

/** Enqueue a protective-filing check when advancing time enters the policy window (before the time bar itself). */
export async function enqueueDueDeadlineChecks(ctx: MutationCtx, ns: string, simNow: number) {
  const policies = await loadPolicies(ctx, ns);
  const asks = await ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", ns)).collect();
  for (const ask of asks) {
    if (ask.deadlineAt === undefined || !deadlineFallbackDue(ask, simNow, ask.deadlineAt, policies)) continue;
    const idempotencyKey = `deadline:${ask._id}`;
    if (await ctx.db.query("agentTasks").withIndex("by_idempotency", q => q.eq("ns", ns).eq("idempotencyKey", idempotencyKey)).unique()) continue;
    const taskId = await ctx.db.insert("agentTasks", { ns, origin: "SYSTEM", kind: "DEADLINE_CHECK", caseId: ask.caseId, triggerAskId: ask._id, state: "QUEUED", attempt: 0, idempotencyKey, createdAt: Date.now(), updatedAt: Date.now() });
    await scheduleTask(ctx, taskId);
  }
}

/** Watchdog: RUNNING tasks whose lease expired are re-queued (≤ 3 attempts) or failed visibly (ARCHITECTURE §5.2). */
export async function requeueStaleTasks(ctx: MutationCtx, ns: string) {
  const running = await ctx.db.query("agentTasks").withIndex("by_state", q => q.eq("ns", ns).eq("state", "RUNNING")).collect();
  for (const task of running) {
    if (task.leaseUntil === undefined || task.leaseUntil > Date.now()) continue;
    if (task.attempt >= 3) {
      await ctx.db.patch(task._id, { state: "FAILED", leaseToken: undefined, leaseUntil: undefined, error: "Lease expired three times", updatedAt: Date.now() });
      if (task.caseId) await ctx.db.patch(task.caseId, { status: "NEEDS_REVIEW", statusLine: "Paused · agent stopped", updatedAt: Date.now() });
    } else {
      await ctx.db.patch(task._id, { state: "QUEUED", leaseToken: undefined, leaseUntil: undefined, updatedAt: Date.now() });
      await scheduleTask(ctx, task._id);
    }
  }
}

/** The open case for a vessel (most recent non-closed case of any voyage of that vessel). */
export async function openCaseForVessel(ctx: MutationCtx, ns: string, vesselId: Id<"vessels">) {
  const voyages = await ctx.db.query("voyages").withIndex("by_vessel", q => q.eq("ns", ns).eq("vesselId", vesselId)).collect();
  for (const voyage of voyages.sort((a, b) => b.eta - a.eta)) {
    const found = await ctx.db.query("cases").withIndex("by_voyage", q => q.eq("ns", ns).eq("voyageId", voyage._id)).collect();
    const open = found.find(item => item.status !== "CLOSED");
    if (open) return open;
  }
  return null;
}

async function vesselByCode(ctx: MutationCtx, ns: string, code: string) {
  return ctx.db.query("vessels").withIndex("by_code", q => q.eq("ns", ns).eq("code", code)).unique();
}

export async function onWorldEvent(ctx: MutationCtx, event: Doc<"worldEvents">): Promise<Id<"agentTasks">[]> {
  const ns = event.ns;
  const payload = event.payload as Record<string, unknown>;
  const tasks: Id<"agentTasks">[] = [];
  switch (event.type) {
    case "PORT_NOTICE": {
      if (payload.noticeKind === "ADVISORY") { tasks.push(await enqueue(ctx, ns, "FLEET_SCAN", event)); break; }
      const port = await ctx.db.query("ports").withIndex("by_code", q => q.eq("ns", ns).eq("code", String(payload.portCode))).unique();
      if (!port) break;
      for (const item of await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", ns)).collect()) {
        if (item.status === "CLOSED") continue;
        const voyage = await ctx.db.get(item.voyageId);
        if (voyage?.portId === port._id) tasks.push(await enqueue(ctx, ns, "PORT_NOTICE", event, item._id));
      }
      break;
    }
    case "AIS_BATCH": case "DEADLINE": {
      const vessel = await vesselByCode(ctx, ns, String(payload.vesselCode));
      const found = vessel ? await openCaseForVessel(ctx, ns, vessel._id) : null;
      if (found) tasks.push(await enqueue(ctx, ns, event.type === "AIS_BATCH" ? "AIS_UPDATE" : "DEADLINE_CHECK", event, found._id));
      break;
    }
    case "EMAIL": {
      const vessel = await ctx.db.query("vessels").withIndex("by_ns", q => q.eq("ns", ns)).filter(q => q.eq(q.field("imo"), String(payload.vesselImo))).first();
      const found = vessel ? await openCaseForVessel(ctx, ns, vessel._id) : null;
      if (found) tasks.push(await enqueue(ctx, ns, "DOCUMENT_RECEIVED", event, found._id));
      break;
    }
    case "MONTH_END": tasks.push(await enqueue(ctx, ns, "MONTH_END", event)); break;
    case "CUSTOMS_RECORD": case "PERIOD_LOCK": case "CLOCK_NOTE": break; // portal records are found by searching; locks are system
  }
  return tasks;
}

/** True while any agent task is queued or running (the clock waits; ARCHITECTURE §4.1). */
export async function agentBusy(ctx: MutationCtx, ns: string) {
  const queued = await ctx.db.query("agentTasks").withIndex("by_state", q => q.eq("ns", ns).eq("state", "QUEUED")).first();
  if (queued) return true;
  return (await ctx.db.query("agentTasks").withIndex("by_state", q => q.eq("ns", ns).eq("state", "RUNNING")).first()) !== null;
}

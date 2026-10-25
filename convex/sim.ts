// Simulation engine (ARCHITECTURE §4, REQ-SIM-01..02). Event-driven company clock:
// it releases the next world event only when no agent task is queued/running, holds for open gating asks
// (unless "let time pass"), and stops at `runUntil` (the active script's last event).
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { appendAudit } from "./lib/audit";
import { getClock } from "./lib/clock";
import { fail } from "./lib/errors";
import { currentPersona } from "./lib/persona";
import { sendDueReminders } from "./asks";
import { agentBusy, enqueueDueDeadlineChecks, requeueStaleTasks } from "./orchestrator";
import { attachScript, nextUnreleased, releaseEvent } from "./world/release";
import { RTM_STORM } from "../src/world/scripts";
import { DEMO_NS } from "../src/world/personas";

const PACE_MS = { "1x": 1200, "2x": 600 } as const;
const BUSY_RECHECK_MS = 500;
export const PREPARE_MODE = "PREPARE";

const clockView = v.object({
  simNow: v.number(), status: v.union(v.literal("RUNNING"), v.literal("HELD"), v.literal("IDLE")), holdReason: v.optional(v.string()),
  pacing: v.union(v.literal("1x"), v.literal("2x")), prevSimNow: v.optional(v.number()), changedAtWall: v.optional(v.number()),
  disruptionAvailable: v.boolean(), disruptionActive: v.boolean(),
});

export const clock = query({
  args: {},
  returns: v.union(v.null(), clockView),
  handler: async ctx => {
    const row = await getClock(ctx, DEMO_NS);
    if (!row) return null;
    const script = await ctx.db.query("worldScripts").withIndex("by_code", q => q.eq("ns", DEMO_NS).eq("code", RTM_STORM.code)).unique();
    return {
      simNow: row.simNow, status: row.status, pacing: row.pacing,
      ...(row.holdReason ? { holdReason: row.holdReason } : {}),
      ...(row.prevSimNow !== undefined ? { prevSimNow: row.prevSimNow } : {}),
      ...(row.changedAtWall !== undefined ? { changedAtWall: row.changedAtWall } : {}),
      disruptionAvailable: script?.status === "IDLE" && row.status === "IDLE" && row.simNow === RTM_STORM.defaultAnchorAt,
      disruptionActive: script?.status === "ACTIVE",
    };
  },
});

/** Presenter controls need an authenticated browser session (any persona); they are audited with the acting persona. */
async function presenter(ctx: MutationCtx) {
  if (!(await getAuthUserId(ctx))) fail("NOT_PERMITTED", "Sign-in has not completed");
  const acting = await currentPersona(ctx);
  return { actor: `persona:${acting?.persona.code ?? "OBSERVER"}`, role: acting?.persona.role ?? ("observer" as const) };
}

async function startLoop(ctx: MutationCtx, ns: string, patch: Record<string, unknown>) {
  const row = await getClock(ctx, ns);
  if (!row) throw new Error(`No clock in ${ns}`);
  const loopToken = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  await ctx.db.patch(row._id, { ...patch, status: "RUNNING", loopToken });
  await ctx.scheduler.runAfter(0, internal.sim.tick, { ns, token: loopToken });
}

/** ⚡ New disruption (REQ-SIM-02): attaches RTM-STORM-2026-10 at the baseline and starts the clock. Idempotent. */
export const startDisruption = mutation({
  args: { automation: v.optional(v.boolean()) },
  returns: v.object({ started: v.boolean() }),
  handler: async (ctx, { automation }) => {
    const who = await presenter(ctx);
    const row = await getClock(ctx, DEMO_NS);
    if (!row) fail("NOT_PERMITTED", "The demo is not prepared");
    const script = await ctx.db.query("worldScripts").withIndex("by_code", q => q.eq("ns", DEMO_NS).eq("code", RTM_STORM.code)).unique();
    if (!script || script.status !== "IDLE") return { started: false };
    if (row.simNow !== RTM_STORM.defaultAnchorAt || row.status !== "IDLE") fail("NOT_PERMITTED", "Reset to the baseline first");
    const { lastAt } = await attachScript(ctx, DEMO_NS, RTM_STORM.code);
    await startLoop(ctx, DEMO_NS, { runUntil: lastAt, activeScriptCode: RTM_STORM.code, overrideHold: false, holdReason: undefined });
    await appendAudit(ctx, { ns: DEMO_NS, origin: automation ? "AUTOMATED_TEST" : "HUMAN", actor: who.actor, role: who.role, type: "DISRUPTION_STARTED", entityType: "worldScript", entityId: RTM_STORM.code, correlationId: `script:${RTM_STORM.code}` });
    return { started: true };
  },
});

/** "Let time pass": releases a hold so deadlines can elapse (T-04, T-13). */
export const letTimePass = mutation({
  args: { automation: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { automation }) => {
    const who = await presenter(ctx);
    const row = await getClock(ctx, DEMO_NS);
    if (!row || row.status !== "HELD") return null;
    await startLoop(ctx, DEMO_NS, { overrideHold: true, holdReason: undefined });
    await appendAudit(ctx, { ns: DEMO_NS, origin: automation ? "AUTOMATED_TEST" : "HUMAN", actor: who.actor, role: who.role, type: "TIME_PASS_ALLOWED", entityType: "simClock", entityId: DEMO_NS, correlationId: `clock:${DEMO_NS}` });
    return null;
  },
});

export const setPacing = mutation({
  args: { pacing: v.union(v.literal("1x"), v.literal("2x")), automation: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { pacing }) => {
    await presenter(ctx);
    const row = await getClock(ctx, DEMO_NS);
    if (row) await ctx.db.patch(row._id, { pacing });
    return null;
  },
});

/** Called when an ask is answered or cancelled (V06+): a HELD clock resumes if no gating ask remains. */
export async function resumeIfPossible(ctx: MutationCtx, ns: string) {
  const row = await getClock(ctx, ns);
  if (!row || row.status !== "HELD") return false;
  if (await gatingAsk(ctx, ns)) return false;
  await startLoop(ctx, ns, { holdReason: undefined });
  return true;
}

/** Wakes a RUNNING clock whose loop is waiting on the agent (V06 calls this when a task finishes). */
export async function nudge(ctx: MutationCtx, ns: string) {
  const row = await getClock(ctx, ns);
  if (row?.status === "RUNNING" && row.loopToken) await ctx.scheduler.runAfter(0, internal.sim.tick, { ns, token: row.loopToken });
}

async function gatingAsk(ctx: MutationCtx, ns: string) {
  const open = await ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", ns)).filter(q => q.and(q.eq(q.field("status"), "OPEN"), q.eq(q.field("gatesClock"), true))).first();
  return open;
}

export const tick = internalMutation({
  args: { ns: v.string(), token: v.string() },
  returns: v.null(),
  handler: async (ctx, { ns, token }) => {
    const row = await getClock(ctx, ns);
    if (!row || row.loopToken !== token || row.status !== "RUNNING") return null; // stale or stopped loop
    const ask = await gatingAsk(ctx, ns);
    if (ask && !row.overrideHold) {
      await ctx.db.patch(row._id, { status: "HELD", holdReason: ask.role, loopToken: undefined });
      return null;
    }
    await requeueStaleTasks(ctx, ns);
    if (await agentBusy(ctx, ns)) {
      await ctx.scheduler.runAfter(BUSY_RECHECK_MS, internal.sim.tick, { ns, token });
      return null;
    }
    const next = await nextUnreleased(ctx, ns);
    if (!next || row.runUntil === undefined || next.scheduledAt > row.runUntil) {
      await ctx.db.patch(row._id, { status: "IDLE", loopToken: undefined, activeScriptCode: undefined, overrideHold: false, holdReason: undefined });
      return null;
    }
    const simNow = Math.max(row.simNow, next.scheduledAt);
    await ctx.db.patch(row._id, { prevSimNow: row.simNow, simNow, changedAtWall: Date.now() });
    await sendDueReminders(ctx, ns, simNow);
    await enqueueDueDeadlineChecks(ctx, ns, simNow);
    await releaseEvent(ctx, next);
    const delay = row.activeScriptCode === PREPARE_MODE ? 0 : PACE_MS[row.pacing];
    await ctx.scheduler.runAfter(delay, internal.sim.tick, { ns, token });
    return null;
  },
});

/** Internal: run the clock up to (and excluding) `until` without animation — used by demo:prepare. */
export const runUntil = internalMutation({
  args: { ns: v.string(), until: v.number(), scripts: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { ns, until, scripts }) => {
    for (const code of scripts) await attachScript(ctx, ns, code);
    const first = await nextUnreleased(ctx, ns);
    // Replay starts at the earliest scripted event (e.g. Kestrel, 30 Sep) and stops before `until` (the baseline).
    await startLoop(ctx, ns, { ...(first ? { simNow: first.scheduledAt } : {}), runUntil: until - 1, activeScriptCode: PREPARE_MODE, overrideHold: true, holdReason: undefined });
    return null;
  },
});

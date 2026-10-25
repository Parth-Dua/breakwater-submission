// The demo stories driven event by event (shared by the live smoke run and the transcript replay tests).
// Kestrel + Halden Star replay to the baseline (as demo:prepare does), then the Rotterdam storm with Aster Vale.
import { internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { RTM_BASELINE_AT, RTM_STORM } from "../../../src/world/scripts";
import { attach, releaseNext, runQueued, seedCustomsProcedure, setSimNow, type T } from "./agentWorld";

export type TaskRun = { taskId: Id<"agentTasks">; kind: string; story: string };
type Hooks = { onTask?: (run: TaskRun) => void; onReleased?: (event: { type: string; at: number }) => void };

async function releaseAndRun(t: T, story: string, until: number, hooks: Hooks, respond?: (t: T) => Promise<boolean>) {
  for (;;) {
    const event = await releaseNext(t, until);
    if (!event) return;
    hooks.onReleased?.(event);
    for (;;) {
      await runQueued(t, task => hooks.onTask?.({ taskId: task._id, kind: task.kind, story }));
      if (!respond || !await respond(t)) break;
    }
  }
}

/** Act 0: Kestrel and Halden Star up to the baseline. No human answers (K-1 stays open). */
export async function prepareStory(t: T, hooks: Hooks = {}) {
  await attach(t, "SSZ-KESTREL-2026-10");
  await attach(t, "ALY-HALDEN-2026-10");
  await setSimNow(t, Date.UTC(2026, 8, 30, 18));
  await releaseAndRun(t, "prepare", RTM_BASELINE_AT - 1, hooks);
  // Park at the baseline: reminders due by then are sent.
  await t.mutation(internal.demo.parkClock, {});
}

/** Scripted answers for the Aster Vale work asks (WORLD §5.6; the Controller's line edit arrives in V09). */
async function answerAsterAsks(t: T): Promise<boolean> {
  const open = await t.run(async ctx => (await ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).filter(ask => ask.status === "OPEN" && ask.gatesClock));
  for (const ask of open) {
    if (ask.kind === "COMMERCIAL_DECISION") {
      await t.mutation(internal.asks.respondScripted, { ns: "demo", askCode: ask.code, answer: { optionId: "PARTIAL", amountCents: (ask.amountAtRiskCents ?? 0) - 300_000, reason: "Goodwill: Hansa took a late Q3 cargo" } });
    } else if (ask.kind === "PAYMENT_APPROVAL") {
      await t.mutation(internal.asks.respondScripted, { ns: "demo", askCode: ask.code, answer: { optionId: "APPROVE" } });
    }
  }
  return open.length > 0;
}

/** Act 2: the storm (with the customs procedure ACTIVE, as after Act 1). */
export async function stormStory(t: T, hooks: Hooks = {}) {
  await seedCustomsProcedure(t);
  await attach(t, "RTM-STORM-2026-10");
  await releaseAndRun(t, "storm", RTM_STORM.events.at(-1)!.at, hooks, answerAsterAsks);
}

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../../convex/_generated/api";
import { onWorldEvent } from "../../../convex/orchestrator";
import { RTM_STORM } from "../../../src/world/scripts";
import { utc } from "../../../src/domain/time";
import manifest from "../../../fixtures/documents/manifest.json";
import { anonymousIdentity, testBackend } from "../helpers/convex";

type T = ReturnType<typeof testBackend>;

/** Test-only fake agent: completes queued tasks; a FLEET_SCAN opens the Aster Vale case (what V06's agent will do). */
async function fakeAgent(t: T) {
  await t.run(async ctx => {
    for (const task of await ctx.db.query("agentTasks").withIndex("by_state", q => q.eq("ns", "demo").eq("state", "QUEUED")).collect()) {
      if (task.kind === "FLEET_SCAN") {
        const voyage = (await ctx.db.query("voyages").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "AV-2610")).unique())!;
        const existing = await ctx.db.query("cases").withIndex("by_voyage", q => q.eq("ns", "demo").eq("voyageId", voyage._id)).first();
        if (!existing) await ctx.db.insert("cases", { ns: "demo", origin: "AGENT", code: "DC-2026-0412", voyageId: voyage._id, status: "OPEN", openedAt: utc("2026-10-24T00:00"), statusLine: "Opened", correlationId: "case:DC-2026-0412", updatedAt: 0 });
      }
      await ctx.db.patch(task._id, { state: "SUCCEEDED" });
    }
  });
}

/** Advances fake time and runs due scheduled functions; optionally lets the fake agent work between ticks. */
async function drive(t: T, steps: number, opts: { agent: boolean }) {
  for (let step = 0; step < steps; step++) {
    vi.advanceTimersByTime(1_300);
    await t.finishInProgressScheduledFunctions();
    if (opts.agent) await fakeAgent(t);
  }
}

const clock = (t: T) => t.run(ctx => ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", "demo")).first());

const SCRIPT_DOC_CODES = (manifest as { ns: string; code: string; caseCode?: string }[]).filter(entry => entry.ns === "demo" && !entry.caseCode).map(entry => entry.code);

async function prepared() {
  const t = testBackend();
  await t.action(internal.world.import.importAll, { ns: "demo" });
  // Documents are world data uploaded once (npm run documents:import); stub blobs stand in for the PDFs here.
  const items = await t.run(async ctx => Promise.all(SCRIPT_DOC_CODES.map(async code => ({ code, storageId: await ctx.storage.store(new Blob([code])) }))));
  for (let start = 0; start < items.length; start += 25) await t.mutation(internal.world.importDocuments.register, { ns: "demo", items: items.slice(start, start + 25) });
  await t.action(internal.demo.prepare, { withAgent: false });
  const { identity } = await anonymousIdentity(t);
  return { t, as: t.withIdentity(identity) };
}

describe("V04 simulation engine", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test("T-01/T-02: ⚡ attaches the script at the baseline, releases E1 and enqueues a fleet scan; a second press is a no-op", async () => {
    const { t, as } = await prepared();
    expect(await as.query(api.sim.clock, {})).toMatchObject({ simNow: utc("2026-10-24T00:00"), status: "IDLE", disruptionAvailable: true });
    expect(await as.mutation(api.sim.startDisruption, {})).toEqual({ started: true });
    expect(await as.mutation(api.sim.startDisruption, {})).toEqual({ started: false });
    await drive(t, 1, { agent: false });
    const state = await t.run(async ctx => ({
      events: await ctx.db.query("worldEvents").withIndex("by_ns", q => q.eq("ns", "demo")).collect(),
      tasks: await ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", "demo")).collect(),
    }));
    expect(state.events).toHaveLength(RTM_STORM.events.length);
    expect(state.events.filter(event => event.releasedAt !== undefined).map(event => event.seq)).toEqual([1]);
    expect(state.tasks.map(task => [task.kind, task.state])).toEqual([["FLEET_SCAN", "QUEUED"]]);
    expect(await clock(t)).toMatchObject({ status: "RUNNING", simNow: utc("2026-10-24T00:00") });
  }, 60_000);

  test("T-03: while an agent task is queued the clock does not release the next event", async () => {
    const { t, as } = await prepared();
    await as.mutation(api.sim.startDisruption, {});
    await drive(t, 6, { agent: false });
    const released = await t.run(ctx => ctx.db.query("worldEvents").withIndex("by_ns", q => q.eq("ns", "demo")).filter(q => q.neq(q.field("releasedAt"), undefined)).collect());
    expect(released).toHaveLength(1);
  }, 60_000);

  test("full RTM script with a (test-only) fake agent: 19 events in order, clock ends IDLE on 9 Dec, Oct locked, sources written", async () => {
    const { t, as } = await prepared();
    await as.mutation(api.sim.startDisruption, {});
    await drive(t, 60, { agent: true });
    const final = await clock(t);
    expect(final).toMatchObject({ status: "IDLE", simNow: utc("2026-12-09T10:00") });
    await t.run(async ctx => {
      const events = await ctx.db.query("worldEvents").withIndex("by_ns", q => q.eq("ns", "demo")).collect();
      expect(events.every(event => event.releasedAt === event.scheduledAt)).toBe(true);
      const audit = await ctx.db.query("auditEvents").withIndex("by_ns_seq", q => q.eq("ns", "demo")).collect();
      const releases = audit.filter(event => event.type === "WORLD_EVENT_RELEASED").map(event => event.entityId);
      expect(releases).toEqual(RTM_STORM.events.map(event => `${RTM_STORM.code}#${event.seq}`));
      expect((await ctx.db.query("periods").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "2026-10")).unique())?.status).toBe("LOCKED");
      const mail = await ctx.db.query("mailMessages").withIndex("by_ns", q => q.eq("ns", "demo")).filter(q => q.eq(q.field("origin"), "WORLD_SCRIPT")).collect();
      expect(mail.map(message => message.subject)).toEqual(["MV Aster Vale – Notice of Readiness", "MV Aster Vale – Statement of Facts (final)", "Demurrage invoice 2611 – MV Aster Vale"]);
      expect((await ctx.db.query("customsRecords").withIndex("by_ns", q => q.eq("ns", "demo")).filter(q => q.eq(q.field("origin"), "WORLD_SCRIPT")).collect()).map(record => record.kind)).toEqual(["HOLD", "RELEASE"]);
      const tasks = await ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", "demo")).collect();
      const kinds = tasks.map(task => task.kind);
      expect(kinds.filter(kind => kind === "DOCUMENT_RECEIVED")).toHaveLength(3);
      expect(kinds.filter(kind => kind === "MONTH_END")).toHaveLength(2);
      expect(kinds).toContain("DEADLINE_CHECK");
      expect(kinds).toContain("PORT_NOTICE");
      expect((await ctx.db.query("worldScripts").withIndex("by_code", q => q.eq("ns", "demo").eq("code", RTM_STORM.code)).unique())?.status).toBe("DONE");
    });
  }, 120_000);

  test("T-04: an open gating ask holds the clock with its role; let time pass releases it", async () => {
    const { t, as } = await prepared();
    await as.mutation(api.sim.startDisruption, {});
    await drive(t, 2, { agent: true });
    await t.run(async ctx => {
      const item = (await ctx.db.query("cases").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "DC-2026-0412")).unique())!;
      await ctx.db.insert("asks", { ns: "demo", origin: "AGENT", code: "A-0001", caseId: item._id, kind: "COMMERCIAL_DECISION", role: "trader", question: "File claim?", subject: "recovery", options: [], context: { evidence: [] }, gatesClock: true, status: "OPEN", remindersSent: 0, createdAt: 0 });
    });
    await drive(t, 2, { agent: true });
    expect(await clock(t)).toMatchObject({ status: "HELD", holdReason: "trader" });
    const before = (await clock(t))!.simNow;
    await as.mutation(api.sim.letTimePass, {});
    await drive(t, 3, { agent: true });
    const after = (await clock(t))!;
    expect(after.status).toBe("RUNNING");
    expect(after.simNow).toBeGreaterThan(before);
  }, 60_000);

  test("T-21: duplicate delivery of an event never duplicates tasks", async () => {
    const { t, as } = await prepared();
    await as.mutation(api.sim.startDisruption, {});
    await drive(t, 1, { agent: false });
    const counts = await t.run(async ctx => {
      const event = (await ctx.db.query("worldEvents").withIndex("by_script_seq", q => q.eq("ns", "demo").eq("scriptCode", RTM_STORM.code).eq("seq", 1)).unique())!;
      await onWorldEvent(ctx, event);
      await onWorldEvent(ctx, event);
      return (await ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).length;
    });
    expect(counts).toBe(1);
  }, 60_000);

  test("T-25: reset restores the baseline; history, documents and other namespaces are untouched; the chain continues", async () => {
    const { t, as } = await prepared();
    await t.action(internal.world.import.importAll, { ns: "score" });
    const baseline = await t.run(async ctx => ({
      history: (await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).length,
      score: (await ctx.db.query("voyages").withIndex("by_ns", q => q.eq("ns", "score")).collect()).length,
    }));
    await as.mutation(api.sim.startDisruption, {});
    await drive(t, 20, { agent: true });
    await as.mutation(api.session.setActingAs, { code: "CONTROLLER" });
    await as.mutation(api.demo.reset, { confirm: "demo" }); // schedules the restore (permission path)
    await t.action(internal.demo.restore, { label: "baseline", actor: "persona:CONTROLLER" }); // run it deterministically here
    await t.run(async ctx => {
      const item = await ctx.db.query("cases").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "DC-2026-0412")).unique();
      expect(item).toBeNull();
      expect(await ctx.db.query("worldEvents").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).toHaveLength(0);
      expect(await ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).toHaveLength(0);
      expect((await ctx.db.query("worldScripts").withIndex("by_code", q => q.eq("ns", "demo").eq("code", RTM_STORM.code)).unique())?.status).toBe("IDLE");
      expect((await ctx.db.query("periods").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "2026-10")).unique())?.status).toBe("OPEN");
      expect((await ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", "demo")).first())).toMatchObject({ simNow: utc("2026-10-24T00:00"), status: "IDLE" });
      expect((await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).length).toBe(baseline.history);
      expect((await ctx.db.query("voyages").withIndex("by_ns", q => q.eq("ns", "score")).collect()).length).toBe(baseline.score);
      const audit = await ctx.db.query("auditEvents").withIndex("by_ns_seq", q => q.eq("ns", "demo")).collect();
      expect(audit[audit.length - 1].type).toBe("NAMESPACE_RESET");
      expect(audit.every((event, index) => index === 0 || event.prevHash === audit[index - 1].hash)).toBe(true);
    });
  }, 180_000);

  test("Observer cannot reset; presenter controls need a signed-in session", async () => {
    const { t, as } = await prepared();
    await expect(as.mutation(api.demo.reset, { confirm: "demo" })).rejects.toThrow(/NOT_PERMITTED|WRONG_ROLE/);
    await expect(t.mutation(api.sim.startDisruption, {})).rejects.toThrow(/NOT_PERMITTED/);
  }, 60_000);
});

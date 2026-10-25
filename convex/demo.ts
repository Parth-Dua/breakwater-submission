// Demo lifecycle (REQ-SIM-03, ARCHITECTURE §4): prepare → baseline snapshot; reset restores the snapshot in seconds.
// Immutable world data (company, contracts, history, world PDFs) is never deleted; only dynamic rows are.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { sendDueReminders } from "./asks";
import { appendAudit } from "./lib/audit";
import { requirePersona } from "./lib/persona";
import { RTM_BASELINE_AT } from "../src/world/scripts";

const NS = "demo";
/** Tables whose every row in the namespace is dynamic (changes during a run). */
const ALL_ROWS: TableNames[] = ["simClock", "worldScripts", "worldEvents", "periods", "extractions", "agentTasks", "agentSteps", "asks", "humanEvents", "learningRuns", "traceDiffs", "lessons", "classifierCalls", "backtests", "filings", "explanations"];
/** Tables where history-import rows (and world PDFs) are immutable; everything else is dynamic. */
const NON_HISTORY: TableNames[] = ["cases", "facts", "statements", "statementEdits", "memoryItems", "journalEntries", "journalLines", "mailMessages", "customsRecords", "aisPoints", "documents"];
const DYNAMIC = [...ALL_ROWS, ...NON_HISTORY];

type Row = Record<string, unknown> & { _id: string; origin?: string };
function isDynamic(table: TableNames, row: Row) {
  if (ALL_ROWS.includes(table)) return true;
  if (row.origin === "HISTORY_IMPORT") return false;
  if (table === "documents" && row.origin === "WORLD_SCRIPT") return false; // world PDFs
  return true;
}

export const pageDynamic = internalQuery({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ rows: v.array(v.any()), cursor: v.union(v.string(), v.null()), done: v.boolean() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table as "cases").withIndex("by_ns", q => q.eq("ns", NS)).paginate({ cursor, numItems: 400 });
    return { rows: page.page.filter(row => isDynamic(table as TableNames, row as unknown as Row)), cursor: page.continueCursor, done: page.isDone };
  },
});

export const wipeBatch = internalMutation({
  args: { table: v.string() },
  returns: v.number(),
  handler: async (ctx, { table }) => {
    let deleted = 0;
    for await (const row of ctx.db.query(table as "cases").withIndex("by_ns", q => q.eq("ns", NS))) {
      if (!isDynamic(table as TableNames, row as unknown as Row)) continue;
      await ctx.db.delete(row._id);
      if (++deleted >= 400) break;
    }
    return deleted;
  },
});

export const insertBatch = internalMutation({
  args: { table: v.string(), rows: v.array(v.any()) },
  returns: v.array(v.object({ oldId: v.string(), newId: v.string() })),
  handler: async (ctx, { table, rows }) => {
    const pairs = [];
    for (const row of rows as Row[]) {
      const { _id, _creationTime, ...doc } = row;
      void _creationTime;
      const newId = await ctx.db.insert(table as "cases", doc as never);
      pairs.push({ oldId: _id, newId });
    }
    return pairs;
  },
});

function remap(value: unknown, map: Record<string, string>): unknown {
  if (typeof value === "string") return map[value] ?? value;
  if (Array.isArray(value)) return value.map(item => remap(item, map));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item, map)]));
  return value;
}

export const remapBatch = internalMutation({
  args: { table: v.string(), ids: v.array(v.string()), map: v.record(v.string(), v.string()) },
  returns: v.null(),
  handler: async (ctx, { ids, map }) => {
    for (const id of ids) {
      const row = await ctx.db.get(id as never) as Row | null;
      if (!row) continue;
      const { _id, _creationTime, ...doc } = row;
      void _id; void _creationTime;
      const next = remap(doc, map) as Record<string, unknown>;
      if (JSON.stringify(next) !== JSON.stringify(doc)) await ctx.db.replace(id as never, next as never);
    }
    return null;
  },
});

export const saveSnapshotRow = internalMutation({
  args: { label: v.string(), storageId: v.id("_storage"), rowCounts: v.any(), simNow: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const previous = await ctx.db.query("baselineSnapshots").withIndex("by_label", q => q.eq("ns", NS).eq("label", args.label)).collect();
    for (const row of previous) await ctx.db.delete(row._id);
    await ctx.db.insert("baselineSnapshots", { ns: NS, ...args, createdAt: Date.now() });
    return null;
  },
});

export const latestSnapshot = internalQuery({
  args: { label: v.string() },
  returns: v.union(v.null(), v.object({ storageId: v.id("_storage"), rowCounts: v.any() })),
  handler: async (ctx, { label }) => {
    const row = await ctx.db.query("baselineSnapshots").withIndex("by_label", q => q.eq("ns", NS).eq("label", label)).first();
    return row ? { storageId: row.storageId, rowCounts: row.rowCounts } : null;
  },
});

export const auditReset = internalMutation({
  args: { actor: v.string(), rowCounts: v.any() },
  returns: v.null(),
  handler: async (ctx, { actor, rowCounts }) => {
    await appendAudit(ctx, { ns: NS, origin: "SYSTEM", actor, role: "agent", type: "NAMESPACE_RESET", entityType: "namespace", entityId: NS, correlationId: `reset:${NS}`, details: { rowCounts }, at: RTM_BASELINE_AT });
    return null;
  },
});

/** Deletes every dynamic row in the demo namespace. */
export const wipeDynamic = internalAction({
  args: {},
  returns: v.number(),
  handler: async ctx => {
    let total = 0;
    for (const table of DYNAMIC) {
      for (;;) { const deleted: number = await ctx.runMutation(internal.demo.wipeBatch, { table }); total += deleted; if (deleted < 400) break; }
    }
    return total;
  },
});

/** Serializes the dynamic rows of the demo namespace to storage under `label`. */
export const snapshot = internalAction({
  args: { label: v.string() },
  returns: v.any(),
  handler: async (ctx, { label }) => {
    const tables: Record<string, Row[]> = {};
    const rowCounts: Record<string, number> = {};
    for (const table of DYNAMIC) {
      const rows: Row[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page: { rows: Row[]; cursor: string | null; done: boolean } = await ctx.runQuery(internal.demo.pageDynamic, { table, cursor });
        rows.push(...page.rows);
        if (page.done) break;
        cursor = page.cursor;
      }
      tables[table] = rows;
      rowCounts[table] = rows.length;
    }
    const clock = tables.simClock?.[0];
    const storageId = await ctx.storage.store(new Blob([JSON.stringify(tables)], { type: "application/json" }));
    await ctx.runMutation(internal.demo.saveSnapshotRow, { label, storageId, rowCounts, simNow: Number(clock?.simNow ?? RTM_BASELINE_AT) });
    return rowCounts;
  },
});

/** Restores the snapshot: wipe dynamic rows, re-insert, then rewrite references to the new ids. */
export const restore = internalAction({
  args: { label: v.string(), actor: v.string() },
  returns: v.any(),
  handler: async (ctx, { label, actor }): Promise<unknown> => {
    const meta: { storageId: Id<"_storage">; rowCounts: unknown } | null = await ctx.runQuery(internal.demo.latestSnapshot, { label });
    if (!meta) throw new Error(`No snapshot "${label}". Run npm run demo:prepare.`);
    const blob = await ctx.storage.get(meta.storageId);
    if (!blob) throw new Error("Snapshot blob missing");
    const tables = JSON.parse(await blob.text()) as Record<string, Row[]>;
    await ctx.runAction(internal.demo.wipeDynamic, {});
    const map: Record<string, string> = {};
    const inserted: Record<string, string[]> = {};
    for (const table of DYNAMIC) {
      inserted[table] = [];
      const rows = tables[table] ?? [];
      for (let start = 0; start < rows.length; start += 200) {
        const pairs: { oldId: string; newId: string }[] = await ctx.runMutation(internal.demo.insertBatch, { table, rows: rows.slice(start, start + 200) });
        for (const { oldId, newId } of pairs) { map[oldId] = newId; inserted[table].push(newId); }
      }
    }
    for (const table of DYNAMIC) {
      const ids = inserted[table];
      for (let start = 0; start < ids.length; start += 200) await ctx.runMutation(internal.demo.remapBatch, { table, ids: ids.slice(start, start + 200), map });
    }
    await ctx.runMutation(internal.demo.auditReset, { actor, rowCounts: meta.rowCounts });
    return meta.rowCounts;
  },
});

/** ⋯ → Reset demo (UI §3). Observer cannot reset (CONTRACTS §11); any persona can. */
export const reset = mutation({
  args: { confirm: v.literal("demo"), automation: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { automation }) => {
    const acting = await requirePersona(ctx, ["ops", "controller", "trader"]);
    await ctx.scheduler.runAfter(0, internal.demo.restore, { label: "baseline", actor: automation ? "system:AUTOMATED_TEST:reset" : `persona:${acting.persona.code}` });
    return null;
  },
});

/** Sets the demo clock to the baseline, IDLE. */
export const parkClock = internalMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const clock = await ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", NS)).first();
    await sendDueReminders(ctx, NS, RTM_BASELINE_AT);
    if (clock) await ctx.db.patch(clock._id, { simNow: RTM_BASELINE_AT, status: "IDLE", loopToken: undefined, runUntil: undefined, activeScriptCode: undefined, overrideHold: false, holdReason: undefined, prevSimNow: undefined, changedAtWall: undefined });
    return null;
  },
});

export const prepareStatus = internalQuery({
  args: {},
  returns: v.object({ clockStatus: v.string(), simNow: v.number(), tasks: v.record(v.string(), v.number()), cases: v.array(v.object({ code: v.string(), statusLine: v.string() })) }),
  handler: async ctx => {
    const clock = await ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", NS)).first();
    const tasks: Record<string, number> = {};
    for (const task of await ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", NS)).collect()) tasks[task.state] = (tasks[task.state] ?? 0) + 1;
    const cases = (await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", NS)).collect()).filter(item => item.origin !== "HISTORY_IMPORT");
    return { clockStatus: clock?.status ?? "NONE", simNow: clock?.simNow ?? 0, tasks, cases: cases.map(item => ({ code: item.code, statusLine: item.statusLine })) };
  },
});

/**
 * `npm run demo:prepare` step 1: wipe and import. With the agent (V06+), the clock then replays Kestrel and Halden Star
 * through the real agent up to the baseline; the CLI waits on `prepareStatus` (actions are capped at 10 minutes) and
 * then calls `prepareFinish`. Without the agent, prepare stops after the import (baseline INCOMPLETE).
 */
export const prepareStart = internalAction({
  args: { withAgent: v.boolean() },
  returns: v.object({ wiped: v.number(), imported: v.number() }),
  handler: async (ctx, { withAgent }): Promise<{ wiped: number; imported: number }> => {
    if (withAgent && process.env.BREAKWATER_AGENT !== "live") throw new Error("BREAKWATER_AGENT=live is not set on this deployment; the replay needs the real agent");
    const wiped: number = await ctx.runAction(internal.demo.wipeDynamic, {});
    const imported: { inserted: number } = await ctx.runAction(internal.world.import.importAll, { ns: NS });
    if (withAgent) await ctx.runMutation(internal.sim.runUntil, { ns: NS, until: RTM_BASELINE_AT, scripts: ["SSZ-KESTREL-2026-10", "ALY-HALDEN-2026-10"] });
    return { wiped, imported: imported.inserted };
  },
});

/** Step 2: park the clock at the baseline (sends due reminders) and store the baseline snapshot. */
export const prepareFinish = internalAction({
  args: { requireComplete: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, { requireComplete }): Promise<unknown> => {
    if (requireComplete) {
      const status = await ctx.runQuery(internal.demo.prepareStatus, {});
      if (status.clockStatus !== "IDLE" || !Object.keys(status.tasks).length || Object.entries(status.tasks).some(([state, count]) => count > 0 && !["SUCCEEDED", "WAITING_HUMAN"].includes(state))) throw new Error("Baseline incomplete: agent tasks must finish successfully before snapshotting");
    }
    await ctx.runMutation(internal.demo.parkClock, {});
    return ctx.runAction(internal.demo.snapshot, { label: "baseline" });
  },
});

/** Without the agent: start + finish in one call (tests, and `demo:prepare -- --no-agent`). */
export const prepare = internalAction({
  args: { withAgent: v.literal(false) },
  returns: v.object({ wiped: v.number(), imported: v.number(), incomplete: v.boolean(), rowCounts: v.any() }),
  handler: async (ctx): Promise<{ wiped: number; imported: number; incomplete: boolean; rowCounts: unknown }> => {
    const started: { wiped: number; imported: number } = await ctx.runAction(internal.demo.prepareStart, { withAgent: false });
    const rowCounts: unknown = await ctx.runAction(internal.demo.prepareFinish, {});
    return { ...started, incomplete: true, rowCounts };
  },
});

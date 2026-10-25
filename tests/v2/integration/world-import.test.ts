import { describe, expect, test } from "vitest";
import { internal } from "../../../convex/_generated/api";
import schema from "../../../convex/schema";
import { testBackend } from "../helpers/convex";

const TABLES = Object.keys(schema.tables).filter(name => !name.startsWith("auth") && name !== "users" && name !== "baselineSnapshots");

describe("world import (V02)", () => {
  test("demo import is idempotent and complete; every record carries ns and origin", async () => {
    const t = testBackend();
    const first = await t.action(internal.world.import.importAll, { ns: "demo" });
    expect(first.historyCases).toBe(32);
    expect(first.inserted).toBeGreaterThan(11_000);
    const second = await t.action(internal.world.import.importAll, { ns: "demo" });
    expect(second.inserted).toBe(0);

    const counts = await t.run(async ctx => {
      const result: Record<string, number> = {};
      for (const table of TABLES) {
        const rows = await ctx.db.query(table as "cases").collect();
        result[table] = rows.length;
        for (const row of rows) {
          expect(row.ns, `${table} ns`).toBeTypeOf("string");
          expect(row.origin, `${table} origin`).toBeTypeOf("string");
        }
      }
      return result;
    });
    expect(counts.counterparties).toBe(12);
    expect(counts.ports).toBe(6);
    expect(counts.vessels).toBe(8);
    expect(counts.cases).toBe(32);
    expect(counts.periods).toBe(12);
    expect(counts.policies).toBe(8);
    expect(counts.worldScripts).toBe(3);
    expect(counts.simClock).toBe(1);
    expect(counts.memoryItems).toBe(1); // the historical goodwill precedent
    expect(counts.statementEdits).toBe(2);
    expect(counts.auditEvents).toBe(1); // second (no-op) import is not audited

    await t.run(async ctx => {
      const lines = await ctx.db.query("journalLines").collect();
      const debit = lines.filter(line => line.side === "DEBIT").reduce((sum, line) => sum + line.cents, 0);
      const credit = lines.filter(line => line.side === "CREDIT").reduce((sum, line) => sum + line.cents, 0);
      expect(debit).toBe(credit);
      const clock = await ctx.db.query("simClock").first();
      expect(clock).toMatchObject({ ns: "demo", simNow: Date.UTC(2026, 9, 24), status: "IDLE" });
      const register = await ctx.db.query("contracts").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "NORDHAVN-CP-2019/ASTER_VALE")).unique();
      expect(register?.terms.treatments.PORT_CLOSURE.treatment).toBe("HALF");
      expect(register?.terms.exceptionsApplyOnDemurrage).toBe(true); // planted register omission (WORLD §2)
      const precedent = await ctx.db.query("memoryItems").first();
      expect(precedent).toMatchObject({ kind: "PRECEDENT", status: "PRECEDENT_ONLY" });
      const av = await ctx.db.query("voyages").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "AV-2610")).unique();
      expect(av?.eta).toBe(Date.UTC(2026, 9, 24, 18));
      expect(await ctx.db.query("cases").withIndex("by_voyage", q => q.eq("ns", "demo").eq("voyageId", av!._id)).first()).toBeNull(); // opened only by the disruption
    });
  }, 120_000);

  test("score namespace holds the 24 held-out voyages with all periods open and no cases", async () => {
    const t = testBackend();
    const result = await t.action(internal.world.import.importAll, { ns: "score" });
    expect(result.scoreVoyages).toBe(24);
    await t.run(async ctx => {
      expect((await ctx.db.query("voyages").withIndex("by_ns", q => q.eq("ns", "score")).collect()).length).toBe(24);
      expect((await ctx.db.query("periods").withIndex("by_ns", q => q.eq("ns", "score")).collect()).every(period => period.status === "OPEN")).toBe(true);
      expect((await ctx.db.query("cases").collect()).length).toBe(0);
    });
  }, 60_000);
});

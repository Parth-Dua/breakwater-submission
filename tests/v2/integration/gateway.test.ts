import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { buildAccrual, buildReversalAndAp } from "../../../src/domain/ledger";
import { enqueueDueDeadlineChecks } from "../../../convex/orchestrator";
import { utc } from "../../../src/domain/time";
import { testBackend } from "../helpers/convex";

type T = ReturnType<typeof testBackend>;
const ACTOR = { actor: "agent:test", role: "agent" as const, correlationId: "case:DC-2026-0412" };
const EVIDENCE = [{ kind: "DOC" as const, documentId: "DOC-INV-NORDHAVN-2611" }];

async function setup() {
  const t = testBackend();
  await t.action(internal.world.import.importAll, { ns: "demo" });
  const ids = await t.run(async ctx => {
    const voyage = (await ctx.db.query("voyages").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "AV-2610")).unique())!;
    const caseId = await ctx.db.insert("cases", { ns: "demo", origin: "AGENT", code: "DC-2026-0412", voyageId: voyage._id, status: "OPEN", openedAt: utc("2026-10-24T00:00"), statusLine: "Working", correlationId: "case:DC-2026-0412", updatedAt: 0 });
    const party = async (code: string) => (await ctx.db.query("counterparties").withIndex("by_code", q => q.eq("ns", "demo").eq("code", code)).unique())!._id;
    const persona = async (code: "CONTROLLER" | "TRADER" | "OPS") => {
      const existing = await ctx.db.query("personas").withIndex("by_code", q => q.eq("ns", "demo").eq("code", code)).unique();
      return existing!._id;
    };
    return { caseId, nordhavn: await party("NORDHAVN"), hansa: await party("HANSA"), controller: await persona("CONTROLLER"), trader: await persona("TRADER"), ops: await persona("OPS") };
  });
  return { t, ids };
}

async function answeredAsk(t: T, caseId: Id<"cases">, kind: "PAYMENT_APPROVAL" | "COMMERCIAL_DECISION", personaId: Id<"personas">) {
  return t.run(ctx => ctx.db.insert("asks", { ns: "demo", origin: "AGENT", code: `A-${kind}`, caseId, kind, role: kind === "PAYMENT_APPROVAL" ? "controller" : "trader", question: "q", subject: kind, options: [], context: { evidence: [] }, gatesClock: true, status: "ANSWERED", answer: { optionId: kind === "PAYMENT_APPROVAL" ? "APPROVE" : "PURSUE" }, answeredBy: personaId, answeredAt: 0, remindersSent: 0, createdAt: 0 }));
}

const balances = (t: T) => t.run(async ctx => {
  const lines = await ctx.db.query("journalLines").withIndex("by_ns", q => q.eq("ns", "demo")).filter(q => q.eq(q.field("origin"), "AGENT")).collect();
  const sum: Record<string, number> = {};
  for (const line of lines) {
    const key = line.counterpartyId ? `${line.account}:${line.counterpartyId}` : line.account;
    sum[key] = (sum[key] ?? 0) + (line.side === "DEBIT" ? line.cents : -line.cents);
  }
  return sum;
});

describe("V05 gateway", () => {
  test("W-15: the Aster Vale journal sequence balances and ends at the answer-key balances", async () => {
    const { t, ids } = await setup();
    const post = (draft: ReturnType<typeof buildAccrual>, postedAt: number, key: string, authority: object, delegation = {}) =>
      t.mutation(internal.gateway.postJournal, { ns: "demo", draft: draft!, caseId: ids.caseId, postedAt, idempotencyKey: key, authority: authority as never, evidence: EVIDENCE, delegation, ...ACTOR });
    await post(buildAccrual("DC-2026-0412", 8_000_000, 0), utc("2026-10-31T23:59"), "acc:2026-10", { kind: "DELEGATION", policyCode: "ACCRUAL" });
    const traderAsk = await answeredAsk(t, ids.caseId, "COMMERCIAL_DECISION", ids.trader);
    await t.mutation(internal.gateway.fileRecoveryClaim, { ns: "demo", caseId: ids.caseId, counterpartyId: ids.hansa, cents: 9_060_000, kind: "RECOVERY_CLAIM", authority: { kind: "APPROVAL", askId: traderAsk, personaId: ids.trader }, filedAt: utc("2026-11-02T12:10"), evidence: EVIDENCE, counterpartyStrategic: true, ...ACTOR });
    await post(buildAccrual("DC-2026-0412", 11_000_000, 8_000_000), utc("2026-11-30T23:59"), "acc:2026-11", { kind: "DELEGATION", policyCode: "ACCRUAL" });
    const controllerAsk = await answeredAsk(t, ids.caseId, "PAYMENT_APPROVAL", ids.controller);
    const [reversal, ap] = buildReversalAndAp("DC-2026-0412", 11_000_000, 12_215_000, ids.nordhavn);
    const approval = { kind: "APPROVAL", askId: controllerAsk, personaId: ids.controller };
    await post(reversal, utc("2026-12-09T10:05"), "rev", approval);
    await post(ap, utc("2026-12-09T10:05"), "ap", approval);
    expect(await balances(t)).toEqual({
      "5100": 12_215_000, "2150": 0, [`2000:${ids.nordhavn}`]: -12_215_000, [`1200:${ids.hansa}`]: 9_060_000, "5190": -9_060_000,
    });
    const entries = await t.run(ctx => ctx.db.query("journalEntries").withIndex("by_case", q => q.eq("ns", "demo").eq("caseId", ids.caseId)).collect());
    expect(entries.map(entry => [entry.kind, entry.periodCode])).toEqual([["ACCRUAL", "2026-10"], ["AR_RECOVERY", "2026-11"], ["ACCRUAL_TRUEUP", "2026-11"], ["ACCRUAL_REVERSAL", "2026-12"], ["AP", "2026-12"]]);
  }, 60_000);

  test("T-10: posting into a locked period is rejected; the current open period accepts it", async () => {
    const { t, ids } = await setup();
    await t.run(async ctx => { const october = (await ctx.db.query("periods").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "2026-10")).unique())!; await ctx.db.patch(october._id, { status: "LOCKED" }); });
    const draft = buildAccrual("DC-2026-0412", 8_000_000, 0)!;
    await expect(t.mutation(internal.gateway.postJournal, { ns: "demo", draft, caseId: ids.caseId, postedAt: utc("2026-10-31T23:59"), idempotencyKey: "x", authority: { kind: "DELEGATION", policyCode: "ACCRUAL" }, evidence: EVIDENCE, ...ACTOR })).rejects.toThrow(/PERIOD_LOCKED/);
    await expect(t.mutation(internal.gateway.postJournal, { ns: "demo", draft, caseId: ids.caseId, postedAt: utc("2026-11-03T00:00"), idempotencyKey: "y", authority: { kind: "DELEGATION", policyCode: "ACCRUAL" }, evidence: EVIDENCE, ...ACTOR })).resolves.toBeDefined();
  }, 60_000);

  test("delegation vs approval: over-limit AP needs a Controller approval; approvers are checked; evidence is required", async () => {
    const { t, ids } = await setup();
    const [ap] = buildReversalAndAp("DC-2026-0412", 0, 12_215_000, ids.nordhavn); // no accrual → AP only
    const base = { ns: "demo", draft: ap, caseId: ids.caseId, postedAt: utc("2026-12-09T10:05"), evidence: EVIDENCE, ...ACTOR };
    await expect(t.mutation(internal.gateway.postJournal, { ...base, idempotencyKey: "a", authority: { kind: "DELEGATION", policyCode: "AP_POSTING" } })).rejects.toThrow(/OVER_DELEGATION/);
    const opsAnswered = await answeredAsk(t, ids.caseId, "PAYMENT_APPROVAL", ids.ops);
    await expect(t.mutation(internal.gateway.postJournal, { ...base, idempotencyKey: "b", authority: { kind: "APPROVAL", askId: opsAnswered, personaId: ids.ops } })).rejects.toThrow(/SOD_VIOLATION/);
    await expect(t.mutation(internal.gateway.postJournal, { ...base, idempotencyKey: "c", authority: { kind: "APPROVAL", askId: opsAnswered, personaId: ids.controller } })).rejects.toThrow(/NOT_PERMITTED/);
    await expect(t.mutation(internal.gateway.postJournal, { ...base, evidence: [], idempotencyKey: "d", authority: { kind: "DELEGATION", policyCode: "AP_POSTING" } })).rejects.toThrow(/MISSING_EVIDENCE/);
    const traderAnswered = await answeredAsk(t, ids.caseId, "COMMERCIAL_DECISION", ids.trader);
    await expect(t.mutation(internal.gateway.postJournal, { ...base, idempotencyKey: "trader-ap", authority: { kind: "APPROVAL", askId: traderAnswered, personaId: ids.trader } })).rejects.toThrow(/SOD_VIOLATION/);
    const controllerAnswered = await answeredAsk(t, ids.caseId, "PAYMENT_APPROVAL", ids.controller);
    await t.run(ctx => ctx.db.patch(controllerAnswered, { answer: { optionId: "REJECT", reason: "Not approved" } }));
    await expect(t.mutation(internal.gateway.postJournal, { ...base, idempotencyKey: "rejected-ap", authority: { kind: "APPROVAL", askId: controllerAnswered, personaId: ids.controller } })).rejects.toThrow(/NOT_PERMITTED/);
    const small = buildReversalAndAp("DC-2026-0412", 0, 3_600_000, ids.nordhavn)[0];
    await expect(t.mutation(internal.gateway.postJournal, { ...base, draft: small, idempotencyKey: "e", authority: { kind: "DELEGATION", policyCode: "AP_POSTING" }, delegation: { statementComplete: true } })).resolves.toBeDefined();
  }, 60_000);

  test("S-08 / T-21: a repeated idempotency key returns the same entry and writes no new lines", async () => {
    const { t, ids } = await setup();
    const args = { ns: "demo", draft: buildAccrual("DC-2026-0412", 8_000_000, 0)!, caseId: ids.caseId, postedAt: utc("2026-10-31T23:59"), idempotencyKey: "acc:2026-10", authority: { kind: "DELEGATION" as const, policyCode: "ACCRUAL" as const }, evidence: EVIDENCE, ...ACTOR };
    const first = await t.mutation(internal.gateway.postJournal, args);
    const second = await t.mutation(internal.gateway.postJournal, { ...args, draft: buildAccrual("DC-2026-0412", 9_999_900, 0)! });
    expect(second).toBe(first);
    const lines = await t.run(ctx => ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("ns", "demo").eq("entryId", first)).collect());
    expect(lines.map(line => line.cents)).toEqual([8_000_000, 8_000_000]);
  }, 60_000);

  test("asks are routed by policy; within delegation no ask is allowed; duplicates and long questions are rejected", async () => {
    const { t, ids } = await setup();
    const ask = (need: "PAYMENT" | "RECOVERY_FILING" | "FACT", amountAtRiskCents: number, subject: string = need, question = "Approve $110,150 to Nordhavn, dispute $29,000? Over $50,000 limit.", delegation = {}) =>
      t.mutation(internal.gateway.createAsk, { ns: "demo", caseId: ids.caseId, need, question, subject, options: [{ id: "APPROVE", label: "Approve" }], context: { evidence: EVIDENCE }, amountAtRiskCents, delegation, createdAt: utc("2026-12-09T10:05"), ...ACTOR });
    const payment = await ask("PAYMENT", 11_015_000);
    const recovery = await ask("RECOVERY_FILING", 9_360_000, "recovery", "File $93,600 demurrage claim on Hansa Mills? Time bar 2 Dec.", { counterpartyStrategic: true });
    const roles = await t.run(async ctx => [(await ctx.db.get(payment))!, (await ctx.db.get(recovery))!].map(row => [row.role, row.kind, row.gatesClock]));
    expect(roles).toEqual([["controller", "PAYMENT_APPROVAL", true], ["trader", "COMMERCIAL_DECISION", true]]);
    await expect(ask("PAYMENT", 11_015_000)).rejects.toThrow(/DUPLICATE/);
    await expect(ask("RECOVERY_FILING", 2_700_000, "litoral", "File?", { counterpartyStrategic: false })).rejects.toThrow(/NOT_PERMITTED/);
    await expect(ask("FACT", 0, "x", "x".repeat(141))).rejects.toThrow(/≤ 140/);
    expect((await t.run(ctx => ctx.db.get(ids.caseId)))?.status).toBe("WAITING_HUMAN");
  }, 60_000);

  test("T-13: fallback is queued before the deadline, rejects early/expired filings and posts the full protective claim once", async () => {
    const { t, ids } = await setup();
    await t.run(async ctx => {
      await ctx.db.insert("facts", { ns: "demo", origin: "AGENT", caseId: ids.caseId, key: "COMPLETION", value: { at: utc("2026-11-02T06:00") }, evidence: EVIDENCE, establishedBy: "AGENT", at: 0 });
      await ctx.db.insert("asks", { ns: "demo", origin: "AGENT", code: "A-1", caseId: ids.caseId, kind: "COMMERCIAL_DECISION", role: "trader", question: "File claim?", subject: "RECOVERY", options: [{ id: "PARTIAL", label: "Partial", requires: ["AMOUNT", "REASON"] }], amountAtRiskCents: 9_360_000, context: { evidence: EVIDENCE }, gatesClock: true, status: "OPEN", deadlineAt: utc("2026-12-02T06:00"), remindersSent: 0, createdAt: utc("2026-11-02T12:00") });
    });
    await expect(t.mutation(internal.asks.respondScripted, { ns: "demo", askCode: "A-1", answer: { optionId: "PARTIAL", amountCents: 9_360_001, reason: "Too high" } })).rejects.toThrow(/NOT_PERMITTED/);
    const file = (at: number) => t.mutation(internal.gateway.fileRecoveryClaim, { ns: "demo", caseId: ids.caseId, counterpartyId: ids.hansa, cents: 9_360_000, kind: "PROTECTIVE_NOTICE", authority: { kind: "DELEGATION", policyCode: "DEADLINE_FALLBACK" }, filedAt: at, evidence: EVIDENCE, counterpartyStrategic: true, ...ACTOR });
    await expect(file(utc("2026-11-02T12:00"))).rejects.toThrow(/NOT_PERMITTED/);
    await expect(file(utc("2026-12-02T06:00"))).rejects.toThrow(/NOT_PERMITTED/);
    await t.run(ctx => enqueueDueDeadlineChecks(ctx, "demo", utc("2026-11-02T12:00")));
    expect(await t.run(ctx => ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", "demo")).collect())).toEqual([]);
    await t.run(ctx => enqueueDueDeadlineChecks(ctx, "demo", utc("2026-11-30T23:59")));
    await t.run(ctx => enqueueDueDeadlineChecks(ctx, "demo", utc("2026-11-30T23:59")));
    const tasks = await t.run(ctx => ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ kind: "DEADLINE_CHECK", state: "QUEUED", caseId: ids.caseId });
    const filingId = await file(utc("2026-11-30T23:59"));
    expect(await file(utc("2026-11-30T23:59"))).toBe(filingId);
    expect(await t.run(ctx => ctx.db.get(filingId))).toMatchObject({ kind: "PROTECTIVE_NOTICE", cents: 9_360_000 });
    const entries = await t.run(ctx => ctx.db.query("journalEntries").withIndex("by_case", q => q.eq("ns", "demo").eq("caseId", ids.caseId)).collect());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "AR_RECOVERY", periodCode: "2026-11", authority: { kind: "DELEGATION", policyCode: "DEADLINE_FALLBACK" } });
  }, 60_000);

  test("T-27: the audit chain verifies; tampering with one event is detected at its sequence", async () => {
    const { t, ids } = await setup();
    await t.mutation(internal.gateway.postJournal, { ns: "demo", draft: buildAccrual("DC-2026-0412", 8_000_000, 0)!, caseId: ids.caseId, postedAt: utc("2026-10-31T23:59"), idempotencyKey: "k", authority: { kind: "DELEGATION", policyCode: "ACCRUAL" }, evidence: EVIDENCE, ...ACTOR });
    const ok = await t.query(api.audit.verifyChain, { ns: "demo" });
    expect(ok.ok).toBe(true);
    expect(ok.length).toBeGreaterThanOrEqual(2);
    await t.run(async ctx => {
      const second = (await ctx.db.query("auditEvents").withIndex("by_ns_seq", q => q.eq("ns", "demo").eq("seq", 2)).unique())!;
      await ctx.db.patch(second._id, { details: { tampered: true } });
    });
    expect(await t.query(api.audit.verifyChain, { ns: "demo" })).toEqual({ ok: false, length: 1, firstBadSeq: 2 });
  }, 60_000);
});

describe("S-08 static: posted journal lines are never mutated", () => {
  test("only the gateway inserts journal lines; nothing patches or replaces them; deletes only in the demo wipe", () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) { if (name !== "_generated") walk(path); } else if (path.endsWith(".ts")) files.push(path); } };
    walk("convex");
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/insert\("journalLines"/.test(source) && !/convex\/(gateway|world\/import)\.ts$/.test(file)) offenders.push(`${file}: inserts journal lines`);
      if (/journalLines[\s\S]{0,200}\.(patch|replace)\(/.test(source)) offenders.push(`${file}: patches/replaces journal lines`);
    }
    expect(offenders).toEqual([]);
  });
});

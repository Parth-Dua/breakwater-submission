import { afterAll, beforeAll, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { api } from "../../../convex/_generated/api";
import { generateHistory } from "../../../src/world/history";
import { utc } from "../../../src/domain/time";
import { agentWorld, attach, releaseNext, replayClient, setClaudeClient, type T, type Transcript } from "../helpers/agentWorld";
import { prepareStory, stormStory } from "../helpers/stories";

const historyOpenPayable = generateHistory().flatMap(item => item.journals).flatMap(entry => entry.lines).filter(line => ["2000", "2150"].includes(line.account)).reduce((sum, line) => sum + (line.side === "CREDIT" ? line.cents : -line.cents), 0);
let t: T;
beforeAll(async () => {
  t = await agentWorld({ pdfs: false });
  const client = replayClient(JSON.parse(readFileSync("fixtures/agent-transcripts/prepare.json", "utf8")) as Transcript);
  setClaudeClient(client); await prepareStory(t); expect(client.remaining()).toBe(0); setClaudeClient(null);
}, 120_000);
afterAll(() => setClaudeClient(null));

test("V07 baseline: 32 closed, actual case figures/statuses, K-1 age and a balanced journal-derived company summary", async () => {
  const rows = await t.query(api.desk.cases, {});
  expect(rows).toHaveLength(34);
  expect(rows.filter(row => row.closed)).toHaveLength(32);
  expect(rows.filter(row => !row.closed).map(row => [row.vessel, row.oweCents, row.recoverCents])).toEqual([["Kestrel", 3_600_000, 1_800_000], ["Halden Star", 3_000_000, 2_700_000]]);
  expect(rows[0]).toMatchObject({ status: "WAITING_HUMAN", statusLine: "Waiting · Ops" });
  const summary = await t.query(api.desk.summary, {});
  expect(summary.kpis).toEqual({ oweCents: historyOpenPayable, recoverableCents: 2_700_000, netCents: 2_700_000, timeBars: 0 });
  expect(summary.clock).toMatchObject({ simNow: utc("2026-10-24T00:00"), status: "IDLE" });
  const waiting = await t.query(api.desk.waitingOnPeople, {});
  expect(waiting.ops).toHaveLength(1); expect(waiting.controller).toEqual([]); expect(waiting.trader).toEqual([]);
  expect(waiting.ops[0]).toMatchObject({ code: "K-1", vessel: "Kestrel", ageDays: 16, amountAtRiskCents: 900_000 });
  const balance = await t.query(api.books.trialBalance, {});
  expect(balance.balanced).toBe(true); expect(balance.debitCents).toBe(balance.creditCents);
  const journals = await t.query(api.books.journals, { filter: "THIS_QUARTER" });
  expect(journals).toHaveLength(1); expect(journals[0]).toMatchObject({ kind: "AR_RECOVERY", cents: 2_700_000, authority: "Delegation", vessel: "Halden Star" });
  expect(journals[0].lines.map(line => [line.account, line.side, line.cents])).toEqual([["1200", "DEBIT", 2_700_000], ["5190", "CREDIT", 2_700_000]]);
  expect((await t.query(api.books.journals, { filter: "ALL" })).length).toBeGreaterThan(100);
}, 60_000);

test("V07 projections never expose internal identity, leases, provider messages or score-namespace records", async () => {
  await t.action((await import("../../../convex/_generated/api")).internal.world.import.importAll, { ns: "score" });
  const rows = await t.query(api.desk.cases, {});
  expect(rows).toHaveLength(34);
  for (const result of [rows, await t.query(api.books.journals, {}), await t.query(api.desk.waitingOnPeople, {})]) {
    expect(JSON.stringify(result)).not.toMatch(/leaseToken|authUserId|correlationId|tokensIn|"_id"|"_creationTime"/);
  }
  expect((await t.query(api.desk.learnedRecently, { limit: 100 })).length).toBeLessThanOrEqual(5);
}, 60_000);

test("V07 working status follows real task steps and uses simulation timestamps", async () => {
  const ids = await t.run(async ctx => {
    const item = (await ctx.db.query("cases").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "DC-2026-0405")).unique())!;
    const taskId = await ctx.db.insert("agentTasks", { ns: "demo", origin: "SYSTEM", kind: "AIS_UPDATE", caseId: item._id, state: "RUNNING", attempt: 1, idempotencyKey: "desk-live-status", createdAt: Date.now(), updatedAt: Date.now() });
    await ctx.db.insert("agentSteps", { ns: "demo", origin: "AGENT", taskId, caseId: item._id, seq: 100, status: "RUNNING", title: "Checked a new vessel position", evidence: [], memoryRefs: [], toolCalls: [], simAt: utc("2026-10-24T00:00"), wallAt: Date.now() });
    return { taskId };
  });
  const rows = await t.query(api.desk.cases, {});
  expect(rows[0]).toMatchObject({ vessel: "Halden Star", status: "WORKING", statusLine: "Checked a new vessel position", updatedAt: utc("2026-10-24T00:00") });
  await t.run(ctx => ctx.db.patch(ids.taskId, { state: "SUCCEEDED" }));
}, 60_000);

test("V07 displays the filed partial recovery and reconciled payable, rather than stale statement estimates", async () => {
  const client = replayClient(JSON.parse(readFileSync("fixtures/agent-transcripts/storm.json", "utf8")) as Transcript);
  setClaudeClient(client); await stormStory(t); expect(client.remaining()).toBe(0); setClaudeClient(null);
  const row = (await t.query(api.desk.cases, {})).find(row => row.vessel === "Aster Vale")!;
  expect(row).toMatchObject({ oweCents: 11_015_000, recoverCents: 9_060_000, netCents: -1_955_000, recoveryFiled: true, closed: true });
  const summary = await t.query(api.desk.summary, {});
  expect(summary.kpis).toMatchObject({ oweCents: historyOpenPayable + 17_615_000, recoverableCents: 11_760_000, netCents: -5_855_000 });
}, 120_000);


test("U-14: queued fleet work is visible immediately from real task/port/ETA data, without inventing a case or money", async () => {
  const isolated = await agentWorld({ pdfs: false });
  await attach(isolated, "RTM-STORM-2026-10");
  await releaseNext(isolated);
  const rows = await isolated.query(api.desk.cases, {});
  expect(rows[0]).toMatchObject({ vessel: "Aster Vale", port: "Rotterdam", status: "WORKING", statusLine: "Queued", provisional: true, code: null, oweCents: null, recoverCents: null, netCents: null });
  const realCases = await isolated.run(ctx => ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
  expect(realCases).toHaveLength(32);
  const tasks = await isolated.run(ctx => ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
  expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ kind: "FLEET_SCAN", state: "QUEUED" });
}, 60_000);

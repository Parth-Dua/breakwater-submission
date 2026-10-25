import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { api, internal } from "../../../convex/_generated/api";
import { anonymousIdentity } from "../helpers/convex";
import { agentWorld, attach, releaseNext, replayClient, runQueued, seedCustomsProcedure, setClaudeClient, type T, type Transcript } from "../helpers/agentWorld";
import { prepareStory } from "../helpers/stories";
import { scriptedClient, text, tool } from "../helpers/mockClaude";

const auto = { automation: true }, caseCode = "DC-2026-0398", releaseCode = "DOC-SSZ-CUSTOMS-RELEASE-1004";
async function prepare() {
  const t = await agentWorld({ pdfs: false });
  const client = replayClient(JSON.parse(readFileSync("fixtures/agent-transcripts/prepare.json", "utf8")) as Transcript);
  setClaudeClient(client); await prepareStory(t); expect(client.remaining()).toBe(0); setClaudeClient(null);
  return t;
}
async function asRole(t: T, code: "OPS" | "CONTROLLER" | "TRADER" | "OBSERVER") {
  const { identity } = await anonymousIdentity(t), user = t.withIdentity(identity);
  await user.mutation(api.session.setActingAs, { code }); return user;
}
async function pendingController(stopBeforeTrader = false) {
  const t = await prepare(), trader = await asRole(t, "TRADER");
  await seedCustomsProcedure(t); await attach(t, "RTM-STORM-2026-10");
  const client = replayClient(JSON.parse(readFileSync("fixtures/agent-transcripts/storm.json", "utf8")) as Transcript); setClaudeClient(client);
  for (let i = 0; i < 40; i++) {
    if (!await releaseNext(t)) throw Error("No payment ask");
    await runQueued(t);
    const asks = await t.run(ctx => ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
    const commercial = asks.find(ask => ask.kind === "COMMERCIAL_DECISION" && ask.status === "OPEN");
    if (commercial && stopBeforeTrader) { setClaudeClient(null); return t; }
    if (commercial) { await trader.mutation(api.asks.answer, { askCode: commercial.code, answer: { optionId: "PARTIAL", amountCents: 9_060_000, reason: "Goodwill: Hansa took a late Q3 cargo" }, ...auto }); await runQueued(t); }
    if (asks.some(ask => ask.kind === "PAYMENT_APPROVAL" && ask.status === "OPEN")) { setClaudeClient(null); return t; }
  }
  throw Error("No payment ask");
}
// This driver explicitly runs queued tasks/actions. Keep scheduled copies from racing
// storage writes in convex-test; live browser acceptance exercises the real scheduler.
beforeEach(() => vi.useFakeTimers());
afterEach(() => { setClaudeClient(null); vi.useRealTimers(); });

test("U-16: actual source search/open/link/unlink/answer provenance is ordered and automation never becomes human evidence", async () => {
  const t = await prepare(), ops = await asRole(t, "OPS");
  await ops.mutation(api.work.start, { askCode: "K-1", ...auto }); await ops.mutation(api.work.start, { askCode: "K-1", ...auto });
  const results = await ops.mutation(api.sources.search, { caseCode, system: "CUSTOMS_PORTAL", query: "Kestrel", ...auto });
  expect(results.some(row => row.code === releaseCode)).toBe(true);
  const doc = await ops.mutation(api.sources.openDocument, { caseCode, documentCode: releaseCode, ...auto }); expect(doc.url).toBeTruthy();
  const evidence = { kind: "DOC" as const, documentId: releaseCode };
  await ops.mutation(api.asks.linkEvidence, { askCode: "K-1", evidence, ...auto });
  await ops.mutation(api.asks.linkEvidence, { askCode: "K-1", evidence: { documentId: releaseCode, kind: "DOC" }, ...auto });
  await ops.mutation(api.asks.unlinkEvidence, { askCode: "K-1", evidence, ...auto });
  await expect(ops.mutation(api.asks.answer, { askCode: "K-1", answer: { optionId: "CONFIRM", evidence: [evidence] }, ...auto })).rejects.toThrow(/MISSING_EVIDENCE/);
  await ops.mutation(api.asks.linkEvidence, { askCode: "K-1", evidence, ...auto });
  await ops.mutation(api.asks.answer, { askCode: "K-1", answer: { optionId: "CONFIRM", evidence: [evidence] }, ...auto });
  expect((await ops.query(api.session.me, {})).persona.code).toBe("OBSERVER");
  const events = await t.run(ctx => ctx.db.query("humanEvents").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
  expect(events.map(event => event.type)).toEqual(["WORK_STARTED", "SOURCE_SEARCHED", "DOCUMENT_OPENED", "EVIDENCE_LINKED", "EVIDENCE_UNLINKED", "EVIDENCE_LINKED", "ANSWER_SUBMITTED"]);
  expect(events.map(event => event.seq)).toEqual([1,2,3,4,5,6,7]); expect(events.every(event => event.origin === "AUTOMATED_TEST")).toBe(true);
  setClaudeClient(scriptedClient([() => [tool("compute_statement", { caseCode: "x", side: "RECOVERABLE" })], () => [tool("file_recovery", { caseCode: "x" })], () => [text("Done.")]])); await runQueued(t);
  expect(await t.query(api.room.money, { caseCode })).toMatchObject({ recoverCents: 2_700_000, recoveryState: "filed" });
  await expect(ops.mutation(api.asks.answer, { askCode: "K-1", answer: { optionId: "CANT_FIND" }, ...auto })).rejects.toThrow();
}, 120_000);

test("S-03: wrong roles, unlinked/unopened evidence, cross-vessel/future documents and fabricated quotes fail", async () => {
  const t = await prepare(), ops = await asRole(t, "OPS"), trader = await asRole(t, "TRADER"), controller = await asRole(t, "CONTROLLER"), observer = await asRole(t, "OBSERVER");
  for (const user of [trader, controller, observer]) await expect(user.mutation(api.asks.answer, { askCode: "K-1", answer: { optionId: "CANT_FIND" }, ...auto })).rejects.toThrow(/WRONG_ROLE/);
  await expect(ops.mutation(api.asks.linkEvidence, { askCode: "K-1", evidence: { kind: "DOC", documentId: releaseCode }, ...auto })).rejects.toThrow(/Open the document/);
  await expect(ops.mutation(api.sources.openDocument, { caseCode, documentCode: "DOC-RTM-PHYTO-RELEASE", ...auto })).rejects.toThrow();
  await ops.mutation(api.sources.openDocument, { caseCode, documentCode: releaseCode, ...auto });
  await expect(ops.mutation(api.asks.linkEvidence, { askCode: "K-1", evidence: { kind: "DOC", documentId: releaseCode, quote: "fictional permission to pay" }, ...auto })).rejects.toThrow(/QUOTE_NOT_FOUND/);
  await ops.mutation(api.sources.openDocument, { caseCode, documentCode: "DOC-NOR-KESTREL", ...auto });
  const wrong = { kind: "DOC" as const, documentId: "DOC-NOR-KESTREL" };
  await ops.mutation(api.asks.linkEvidence, { askCode: "K-1", evidence: wrong, ...auto });
  await expect(ops.mutation(api.asks.answer, { askCode: "K-1", answer: { optionId: "CONFIRM", evidence: [wrong] }, ...auto })).rejects.toThrow(/authority release/);
}, 120_000);

test("T-12/T-15: Trader partial is filed; Controller drafts are isolated, stale edits fail, and approved COUNT posts the correct journals", async () => {
  const t = await pendingController(), controller = await asRole(t, "CONTROLLER"), ops = await asRole(t, "OPS"), trader = await asRole(t, "TRADER");
  const aster = { caseCode: "DC-2026-0412" };
  expect(await t.query(api.room.money, aster)).toMatchObject({ recoverCents: 9_060_000 });
  for (const user of [ops, trader]) await expect(user.mutation(api.asks.answer, { askCode: "A-2", answer: { optionId: "APPROVE" }, ...auto })).rejects.toThrow(/WRONG_ROLE/);
  const initial = await controller.query(api.statements.preview, { askCode: "A-2" }), closure = initial!.lines.find(line => line.kind === "PORT_CLOSURE")!;
  const draftArgs = { askCode: "A-2", lineId: closure.id, field: "treatment" as const, to: "COUNT" as const, expectedVersion: initial!.version, basis: { clause: "8", note: "CP cl. 8 proviso: already on demurrage" }, ...auto };
  await expect(controller.mutation(api.statements.editLine, { ...draftArgs, basis: { clause: "8", note: "" } })).rejects.toThrow(/MISSING_EVIDENCE/);
  await expect(controller.mutation(api.statements.editLine, { ...draftArgs, expectedVersion: initial!.version - 1 })).rejects.toThrow(/STALE_VERSION/);
  await controller.mutation(api.statements.editLine, draftArgs);
  const preview = await controller.query(api.statements.preview, { askCode: "A-2" });
  expect(preview!.totals.totalCents).toBe(12_215_000); expect(preview!.disputeCents).toBe(1_700_000);
  expect(preview!.lines.find(line => line.kind === "PORT_CLOSURE")?.deltaCents).toBe(0);
  expect((await t.query(api.room.money, aster))?.oweCents).toBe(11_015_000);
  await expect(controller.mutation(api.asks.answer, { askCode: "A-2", answer: { optionId: "APPROVE", editIds: [] }, expectedVersion: initial!.version, ...auto })).rejects.toThrow(/STALE_VERSION/);
  await controller.mutation(api.asks.answer, { askCode: "A-2", answer: { optionId: "APPROVE", editIds: preview!.editIds }, expectedVersion: preview!.version, ...auto });
  const invoiceCode = await t.run(async ctx => { const c = (await ctx.db.query("cases").withIndex("by_code", q => q.eq("ns", "demo").eq("code", aster.caseCode)).unique())!; return (c.reconciliation as { invoiceCode: string }).invoiceCode; });
  setClaudeClient(scriptedClient([() => [tool("compute_statement", { caseCode: "x", side: "PAYABLE" })], () => [tool("reconcile_invoice", { caseCode: "x", documentCode: invoiceCode })], () => [tool("post_ap", { caseCode: "x" })], () => [text("Done.")]])); await runQueued(t);
  expect(await t.query(api.room.money, aster)).toMatchObject({ oweCents: 12_215_000, netCents: -3_155_000, payableState: "approved" });
  const journals = (await t.query(api.books.journals, { filter: "ALL" })).filter(entry => entry.caseCode === aster.caseCode);
  expect(journals.find(entry => entry.kind === "AP")?.cents).toBe(12_215_000);
  expect(journals.find(entry => entry.kind === "ACCRUAL_REVERSAL")?.cents).toBe(11_000_000);
  const filings = await t.run(ctx => ctx.db.query("filings").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
  const claim = filings.find(filing => filing.kind === "RECOVERY_CLAIM" && filing.cents === 9_060_000)!;
  await t.action(internal.node.documents.renderFiling, { filingId: claim._id });
  await t.action(internal.node.documents.renderFiling, { filingId: claim._id });
  const doc = await t.run(async ctx => { const row = (await ctx.db.get(claim._id))!; return ctx.db.get(row.documentId!); });
  expect(doc?.textLayer).toContain("90,600.00");
  expect(doc?.textLayer).toContain("DOC-SOF"); expect(doc?.textLayer).toContain("DOC-NOR");
  const dispute = filings.find(filing => filing.kind === "DISPUTE" && filing.cents === 1_700_000)!;
  const letter = await t.query(internal.filingDocuments.data, { filingId: dispute._id });
  expect(letter!.rows).toHaveLength(3);
  await t.action(internal.node.documents.renderFiling, { filingId: dispute._id });
  const disputeDoc = await t.run(async ctx => ctx.db.get((await ctx.db.get(dispute._id))!.documentId!));
  expect(disputeDoc?.textLayer).toContain("17,000.00");
  const statements = await t.run(async ctx => { const c = (await ctx.db.query("cases").withIndex("by_code", q => q.eq("ns", "demo").eq("code", aster.caseCode)).unique())!; return ctx.db.query("statements").withIndex("by_case_side_version", q => q.eq("ns", "demo").eq("caseId", c._id).eq("side", "PAYABLE")).collect(); });
  for (const statement of statements) await t.action(internal.node.documents.renderStatement, { statementId: statement._id, issuedAt: Date.UTC(2026,10,5) });
  const pdfs = await t.run(ctx => ctx.db.query("documents").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
  expect(pdfs.find(doc => doc.code === `DOC-${aster.caseCode}-PAYABLE-V${statements.at(-1)!.version}`)?.textLayer).toContain("122,150.00");
  expect((await t.query(api.room.documents, aster)).filter(doc => doc.kind === "RECOVERY_CLAIM")).toHaveLength(1);
  expect((await t.query(api.books.trialBalance, {})).balanced).toBe(true);
}, 120_000);


test("T-13: Let time pass leaves the Trader ask open and triggers only the authorized full protective filing", async () => {
  const t = await pendingController(true), trader = await asRole(t, "TRADER");
  await t.run(async ctx => { const clock = (await ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", "demo")).first())!; await ctx.db.patch(clock._id, { status: "HELD", holdReason: "trader", runUntil: Date.UTC(2026, 11, 2) }); });
  await trader.mutation(api.sim.letTimePass, {});
  expect((await trader.query(api.sim.clock, {}))?.status).toBe("RUNNING");
  while (await releaseNext(t, Date.UTC(2026, 10, 30, 23, 59))) { /* Advance actual released world events after Let time pass. */ }
  const task = await t.run(async ctx => (await ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).find(task => task.kind === "DEADLINE_CHECK" && task.state === "QUEUED"));
  expect(task).toBeTruthy();
  setClaudeClient(scriptedClient([() => [tool("file_recovery", { caseCode: "x", protective: true })], () => [text("Done.")]]));
  await t.action(internal.node.agent.runTask, { taskId: task!._id });
  const filings = await t.run(ctx => ctx.db.query("filings").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
  expect(filings.find(filing => filing.kind === "PROTECTIVE_NOTICE")).toMatchObject({ cents: 9_360_000, authority: { kind: "DELEGATION", policyCode: "DEADLINE_FALLBACK" } });
  const asks = await t.run(ctx => ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
  expect(asks.find(ask => ask.code === "A-1")).toMatchObject({ status: "OPEN" });
}, 120_000);

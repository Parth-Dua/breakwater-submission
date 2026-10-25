import { readFileSync } from "node:fs";
import { beforeAll, afterEach, describe, expect, test } from "vitest";
import { api, internal } from "../../../convex/_generated/api";
import { utc } from "../../../src/domain/time";
import { agentWorld, attach, releaseNext, replayClient, runQueued, seedCustomsProcedure, setClaudeClient, setSimNow, type Transcript, type T } from "../helpers/agentWorld";
import { prepareStory, stormStory } from "../helpers/stories";
import { json, lastToolResult, overloaded, scriptedClient, text, tool, type MockStep } from "../helpers/mockClaude";

afterEach(() => setClaudeClient(null));

const NOR_FIELDS = {
  tenderedAt: { value: "2026-10-24T06:00Z", quote: "NOR tendered 24 Oct 2026 06:00 UTC" },
  statedLocation: { value: "Maas anchorage", quote: "Vessel arrived Maas anchorage" },
  vesselName: { value: "MV Aster Vale", quote: "MV Aster Vale" }, ignoredInstructions: [],
};

const done: MockStep = () => [text("Done.")];
const tasksOf = (t: T) => t.run(ctx => ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
const factsOf = (t: T) => t.run(async ctx => (await ctx.db.query("facts").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).filter(fact => !fact.supersededBy));
const stepsOf = (t: T) => t.run(ctx => ctx.db.query("agentSteps").withIndex("by_ns", q => q.eq("ns", "demo")).collect());

/** Storm world: E1 → fleet scan opens Aster Vale; the two early AIS batches are quiet. */
async function asterOpened() {
  const t = await agentWorld({ pdfs: false });
  await attach(t, "RTM-STORM-2026-10");
  setClaudeClient(scriptedClient([
    () => [tool("record_step", { status: "RUNNING", title: "Checking vessels due in Rotterdam", evidenceDocs: [], memoryRefs: [] }), tool("list_fleet", {})],
    params => {
      const fleet = lastToolResult(params) as { vesselCode: string; portCode: string; hoursToEta: number }[];
      return fleet.filter(row => row.portCode === "NLRTM" && Math.abs(row.hoursToEta) <= 72).map(row => tool("open_case", { vesselCode: row.vesselCode, reason: "Storm advisory for Rotterdam" }));
    },
    done,
    ...Array.from({ length: 2 }, () => [() => [tool("record_intervals", { caseCode: "x", arrivalFromAis: true, shiftingFromAis: true })], done] as MockStep[]).flat(),
  ]));
  for (let i = 0; i < 3; i++) { await releaseNext(t); await runQueued(t); }
  return t;
}

describe("V06 agent runtime (mocked Claude)", () => {
  test("fleet scan opens the case; T-05: the NOR is invalid as tendered; on arrival the deemed start lands with −$12,000 on the step", async () => {
    const t = await asterOpened();
    expect((await tasksOf(t)).map(task => [task.kind, task.state])).toEqual([["FLEET_SCAN", "SUCCEEDED"], ["AIS_UPDATE", "SUCCEEDED"], ["AIS_UPDATE", "SUCCEEDED"]]);
    const client = scriptedClient([
      () => [tool("record_step", { status: "RUNNING", title: "Checking the notice of readiness", evidenceDocs: [], memoryRefs: [] }), tool("read_document", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })],
      params => { expect(params.output_config?.format).toBeDefined(); return [json(NOR_FIELDS)]; },
      () => [tool("check_nor", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })],
      params => { expect(lastToolResult(params)).toMatchObject({ valid: false, reason: "NOT_ARRIVED", laytimeStartPayable: null }); return [tool("record_step", { status: "DONE", title: "Notice tendered outside port limits", evidenceDocs: ["DOC-NOR-ASTERVALE"], memoryRefs: [] })]; },
      done,
      // 18:00 AIS: the vessel enters port limits.
      () => [tool("record_step", { status: "RUNNING", title: "Vessel position update", evidenceDocs: [], memoryRefs: [] }), tool("record_intervals", { caseCode: "x", arrivalFromAis: true, shiftingFromAis: true })],
      done,
    ]);
    setClaudeClient(client);
    await releaseNext(t); await runQueued(t); // NOR email
    let facts = await factsOf(t);
    expect(facts.find(fact => fact.key === "NOR_VALIDITY")?.value).toMatchObject({ valid: false, reason: "NOT_ARRIVED" });
    expect((facts.find(fact => fact.key === "NOR_VALIDITY")!.value as { distanceNm: number }).distanceNm).toBeGreaterThan(20);
    expect(facts.some(fact => fact.key === "LAYTIME_START_PAYABLE")).toBe(false);
    const norStep = (await stepsOf(t)).find(step => step.title === "Notice tendered outside port limits")!;
    expect(norStep.evidence.map(ref => ref.kind).sort()).toEqual(["AIS", "DOC"]);
    await releaseNext(t); await runQueued(t); // AIS 18:00
    facts = await factsOf(t);
    expect(facts.find(fact => fact.key === "LAYTIME_START_PAYABLE")?.value).toEqual({ at: utc("2026-10-25T00:00") });
    expect(facts.find(fact => fact.key === "NOR_VALIDITY")?.value).toMatchObject({ valid: false, reason: "DEEMED_ON_ARRIVAL", effectiveAt: utc("2026-10-24T18:00") });
    const arrivalStep = (await stepsOf(t)).find(step => step.title === "Vessel position update")!;
    expect(arrivalStep.deltaCents).toBe(-1_200_000);
    expect(client.left()).toBe(0);
    expect((await tasksOf(t)).every(task => task.state === "SUCCEEDED")).toBe(true);
  }, 120_000);

  test("T-22: three overloaded responses fail the task visibly with no output; a retry succeeds", async () => {
    const t = await asterOpened();
    setClaudeClient(scriptedClient([overloaded, overloaded, overloaded]));
    await releaseNext(t); await runQueued(t);
    let task = (await tasksOf(t)).find(row => row.kind === "DOCUMENT_RECEIVED")!;
    expect(task).toMatchObject({ state: "FAILED" });
    expect(task.error).toMatch(/unavailable after 3 attempts \(529\)/);
    expect((await t.run(ctx => ctx.db.get(task.caseId!)))?.statusLine).toBe("Paused · model unavailable");
    expect((await factsOf(t)).some(fact => fact.key === "NOR_TENDERED")).toBe(false);
    setClaudeClient(scriptedClient([
      () => [tool("read_document", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })], () => [json(NOR_FIELDS)],
      () => [tool("check_nor", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })], done,
    ]));
    await t.mutation(internal.agent.tools.retryTask, { taskId: task._id });
    await runQueued(t);
    task = (await t.run(ctx => ctx.db.get(task._id)))!;
    expect(task.state).toBe("SUCCEEDED");
  }, 120_000);

  test("T-24: a quote not in the document is rejected; one repair; still missing → NEEDS_REVIEW", async () => {
    const t = await asterOpened();
    const bad = { ...NOR_FIELDS, tenderedAt: { value: "2026-10-24T05:00Z", quote: "NOR tendered 24 Oct 2026 05:00 UTC" } };
    const client = scriptedClient([
      () => [tool("read_document", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })],
      () => [json(bad)],
      params => { expect(JSON.stringify(params.messages.at(-1))).toContain("tenderedAt"); return [json(bad)]; },
      params => { expect(lastToolResult(params)).toMatchObject({ rejected: ["tenderedAt"] }); return [tool("check_nor", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })]; },
      params => { expect(lastToolResult(params)).toMatchObject({ error: "QUOTE_NOT_FOUND" }); return [text("I could not verify the tender time.")]; },
      done, // repair turn after the postcondition check
    ]);
    setClaudeClient(client);
    await releaseNext(t); await runQueued(t);
    const task = (await tasksOf(t)).find(row => row.kind === "DOCUMENT_RECEIVED")!;
    expect(task.state).toBe("NEEDS_REVIEW");
    expect(task.error).toContain("NOR_TENDERED");
    expect(client.left()).toBe(0);
  }, 120_000);

  test("S-06 / T-07: without an active procedure the portal tool is not offered, and a call to it is denied and audited", async () => {
    const t = await asterOpened();
    const client = scriptedClient([
      params => { expect((params.tools ?? []).map(entry => (entry as { name: string }).name)).not.toContain("search_customs_portal"); return [tool("search_customs_portal", { caseCode: "x", from: "2026-10-30T00:00Z", to: "2026-11-01T00:00Z" })]; },
      params => { expect(lastToolResult(params)).toMatchObject({ error: "CAPABILITY_DENIED" }); return [tool("read_document", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })]; },
      () => [json(NOR_FIELDS)], () => [tool("check_nor", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })], done,
    ]);
    setClaudeClient(client);
    await releaseNext(t); await runQueued(t);
    const denied = await t.run(ctx => ctx.db.query("auditEvents").withIndex("by_ns_seq", q => q.eq("ns", "demo")).filter(q => q.eq(q.field("type"), "TOOL_DENIED")).collect());
    expect(denied).toHaveLength(1);
    expect(denied[0].details).toMatchObject({ tool: "search_customs_portal", allowed: false });
  }, 120_000);

  test("S-04/S-05: an agent cannot answer asks or activate memory through its tool surface", async () => {
    const t = await asterOpened();
    setClaudeClient(scriptedClient([
      params => {
        expect((params.tools ?? []).map(entry => (entry as { name: string }).name)).not.toEqual(expect.arrayContaining(["answer_ask", "activate_memory"]));
        return [tool("answer_ask", { optionId: "APPROVE" }), tool("activate_memory", { status: "ACTIVE" })];
      },
      params => { expect(lastToolResult(params)).toMatchObject({ error: "CAPABILITY_DENIED" }); return [tool("read_document", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })]; },
      () => [json(NOR_FIELDS)], () => [tool("check_nor", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })], done,
    ]));
    await releaseNext(t); await runQueued(t);
    const denied = await t.run(ctx => ctx.db.query("auditEvents").withIndex("by_ns_seq", q => q.eq("ns", "demo")).filter(q => q.eq(q.field("type"), "TOOL_DENIED")).collect());
    expect(denied.map(event => (event.details as { tool: string }).tool)).toEqual(["answer_ask", "activate_memory"]);
    expect(await t.run(ctx => ctx.db.query("humanEvents").withIndex("by_ns", q => q.eq("ns", "demo")).collect())).toEqual([]);
    expect((await tasksOf(t)).every(task => task.state === "SUCCEEDED")).toBe(true);
  }, 120_000);

  test("T-08 capability: with P-CUSTOMS-PORTAL-FIRST ACTIVE and an unverified hold, the portal tool is offered", async () => {
    const t = await asterOpened();
    await seedCustomsProcedure(t);
    const offered = async () => {
      const client = scriptedClient([done]);
      setClaudeClient(client);
      const caseId = (await tasksOf(t)).find(task => task.caseId)!.caseId!;
      const taskId = await t.run(ctx => ctx.db.insert("agentTasks", { ns: "demo", origin: "SYSTEM", kind: "PORT_NOTICE", caseId, state: "QUEUED", attempt: 0, idempotencyKey: `probe:${Math.random()}`, createdAt: 0, updatedAt: 0 }));
      await t.action(internal.node.agent.runTask, { taskId });
      return (client.requests[0].tools ?? []).map(entry => (entry as { name: string }).name);
    };
    expect(await offered()).not.toContain("search_customs_portal");
    await t.run(async ctx => {
      const item = (await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", "demo")).filter(q => q.eq(q.field("origin"), "AGENT")).first())!;
      await ctx.db.insert("facts", { ns: "demo", origin: "AGENT", caseId: item._id, key: "INTERVAL", value: { kind: "CUSTOMS_HOLD", startAt: utc("2026-10-30T12:00"), endAt: utc("2026-10-31T18:00"), verified: false, source: "SOF" }, evidence: [], establishedBy: "AGENT", at: 0 });
    });
    expect(await offered()).toEqual(expect.arrayContaining(["search_customs_portal", "verify_hold"]));
  }, 120_000);

  test("AIS: two separate moves after arrival are both kept as shifting (Halden Star: drift in limits, then to berth)", async () => {
    const t = await agentWorld({ pdfs: false });
    await attach(t, "ALY-HALDEN-2026-10");
    await setSimNow(t, utc("2026-10-11T00:00"));
    const record = () => [tool("record_intervals", { caseCode: "x", arrivalFromAis: true, shiftingFromAis: true })];
    setClaudeClient(scriptedClient([
      () => [tool("open_case", { vesselCode: "HALDEN_STAR", reason: "Alexandria advisory" })], done,
      record, done,                                   // AIS 10-12 06:00
      () => [text("Skipping.")], () => [text("Skipping.")], // NOR (not under test)
      record, done,                                   // AIS 10-17 14:00
    ]));
    for (let i = 0; i < 4; i++) { await releaseNext(t); await runQueued(t); }
    const shifts = (await factsOf(t)).filter(fact => fact.key === "INTERVAL" && (fact.value as { kind: string }).kind === "SHIFTING");
    expect(shifts.map(fact => (fact.value as { startAt: number }).startAt).sort()).toEqual([utc("2026-10-12T04:30"), utc("2026-10-12T08:00")]);
    expect((await tasksOf(t)).filter(task => task.kind === "AIS_UPDATE").map(task => task.state)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
  }, 120_000);

  test("REQ-AGT-03: steps and fact questions cannot carry amounts from model text", async () => {
    const t = await asterOpened();
    setClaudeClient(scriptedClient([
      () => [tool("record_step", { status: "DONE", title: "Saved $12,000 on laytime", evidenceDocs: [], memoryRefs: [] })],
      params => { expect(lastToolResult(params)).toMatchObject({ error: "NOT_PERMITTED" }); return [tool("create_ask", { caseCode: "x", need: "FACT", subject: "CUSTOMS_HOLD", question: "Is USD 9,000 at risk?", evidenceDocs: [] })]; },
      params => { expect(lastToolResult(params)).toMatchObject({ error: "NOT_PERMITTED" }); return [tool("read_document", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })]; },
      () => [json(NOR_FIELDS)], () => [tool("check_nor", { caseCode: "x", documentCode: "DOC-NOR-ASTERVALE" })], done,
    ]));
    await releaseNext(t); await runQueued(t);
    expect((await stepsOf(t)).some(step => /\$/.test(`${step.title}${step.observation ?? ""}${step.conclusion ?? ""}`))).toBe(false);
    expect(await t.run(ctx => ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", "demo")).collect())).toHaveLength(0);
  }, 120_000);
});


describe("V06 closure notice before SOF", () => {
  test("T-09: the verified notice drives the October accrual before completion is known", async () => {
    const t = await asterOpened();
    const caseId = (await tasksOf(t)).find(task => task.caseId)!.caseId!;
    const { taskId, eventId } = await t.run(async ctx => {
      const event = (await ctx.db.query("worldEvents").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).find(event => (event.payload as { noticeKind?: string }).noticeKind === "CLOSURE")!;
      const taskId = await ctx.db.insert("agentTasks", { ns: "demo", origin: "SYSTEM", caseId, triggerEventId: event._id, kind: "PORT_NOTICE", state: "QUEUED", attempt: 0, idempotencyKey: "closure-probe", createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("facts", { ns: "demo", origin: "AGENT", caseId, key: "LAYTIME_START_PAYABLE", value: { at: utc("2026-10-25T00:00") }, evidence: [], establishedBy: "AGENT", at: 0 });
      await ctx.db.insert("facts", { ns: "demo", origin: "AGENT", caseId, key: "INTERVAL", value: { kind: "SHIFTING", startAt: utc("2026-10-30T08:00"), endAt: utc("2026-10-30T12:00"), verified: true, source: "AIS" }, evidence: [], establishedBy: "AGENT", at: 0 });
      return { taskId, eventId: event._id };
    });
    await setSimNow(t, utc("2026-10-28T12:00"));
    // Reading without recording the interval cannot pass the notice postcondition.
    setClaudeClient(scriptedClient([done, done]));
    await t.action(internal.node.agent.runTask, { taskId });
    expect((await t.run(ctx => ctx.db.get(taskId)))?.error).toContain("verified closure notice interval");
    const client = scriptedClient([
      () => [tool("read_document", { caseCode: "x", documentCode: "DOC-RTM-CLOSURE-1028" })],
      () => [json({ start: { value: "incorrect model value", quote: "28 Oct 2026 12:00 UTC" }, end: { value: "incorrect model value", quote: "29 Oct 2026 12:00 UTC" }, authority: { value: "Harbour Master", quote: "Harbour Master" }, ignoredInstructions: [] })],
      () => [tool("record_intervals", { caseCode: "x", noticeDocumentCode: "DOC-RTM-CLOSURE-1028" })], done,
    ]);
    setClaudeClient(client);
    await t.mutation(internal.agent.tools.retryTask, { taskId });
    await runQueued(t);
    expect((await t.run(ctx => ctx.db.get(taskId)))?.state).toBe("SUCCEEDED");
    expect(client.left()).toBe(0);
    expect((await factsOf(t)).find(fact => fact.key === "INTERVAL" && (fact.value as { kind: string }).kind === "PORT_CLOSURE")?.value).toMatchObject({ startAt: utc("2026-10-28T12:00"), endAt: utc("2026-10-29T12:00"), verified: true });
    await setSimNow(t, utc("2026-10-31T23:59"));
    const accrualTask = await t.run(async ctx => {
      await ctx.db.patch(eventId, { type: "MONTH_END", payload: { periodCode: "2026-10" } });
      return ctx.db.insert("agentTasks", { ns: "demo", origin: "SYSTEM", kind: "MONTH_END", triggerEventId: eventId, state: "QUEUED", attempt: 0, idempotencyKey: "month-probe", createdAt: 0, updatedAt: 0 });
    });
    setClaudeClient(scriptedClient([() => [tool("post_accrual", { caseCode: "DC-2026-0398" })], done]));
    await t.action(internal.node.agent.runTask, { taskId: accrualTask });
    expect((await t.run(ctx => ctx.db.get(accrualTask)))?.state).toBe("SUCCEEDED");
    const lines = await t.run(ctx => ctx.db.query("journalLines").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
    expect(lines.filter(line => line.origin !== "HISTORY_IMPORT").map(line => [line.account, line.side, line.cents])).toEqual([["5100", "DEBIT", 8_000_000], ["2150", "CREDIT", 8_000_000]]);
  }, 120_000);
});


describe("V06 recorded live Claude replay (automated evidence)", () => {
  let t: T;
  let prepareRequests: ReturnType<typeof replayClient>["requests"];
  beforeAll(async () => {
    const report = JSON.parse(readFileSync("fixtures/agent-transcripts/live-report.json", "utf8")) as { full: boolean; verified: boolean };
    expect(report).toMatchObject({ full: true, verified: true });
    t = await agentWorld({ pdfs: false });
    const prepare = replayClient(JSON.parse(readFileSync("fixtures/agent-transcripts/prepare.json", "utf8")) as Transcript);
    setClaudeClient(prepare);
    await prepareStory(t);
    expect((await tasksOf(t)).filter(task => !["SUCCEEDED", "WAITING_HUMAN"].includes(task.state)).map(task => ({ kind: task.kind, error: task.error }))).toEqual([]);
    expect(prepare.remaining()).toBe(0);
    prepareRequests = prepare.requests;
    const storm = replayClient(JSON.parse(readFileSync("fixtures/agent-transcripts/storm.json", "utf8")) as Transcript);
    setClaudeClient(storm);
    await stormStory(t);
    expect(storm.remaining()).toBe(0);
    setClaudeClient(null);
  }, 120_000);

  test("every recorded task finishes with postconditions met", async () => {
    const tasks = await tasksOf(t);
    expect(new Set(tasks.map(task => task.kind))).toEqual(new Set(["FLEET_SCAN", "AIS_UPDATE", "DOCUMENT_RECEIVED", "PORT_NOTICE", "MONTH_END", "ASK_ANSWERED", "DEADLINE_CHECK"]));
    expect(tasks.filter(task => !["SUCCEEDED", "WAITING_HUMAN"].includes(task.state))).toEqual([]);
  });

  test("T-06/T-08: nine SOF rows, DST completion and portal verification with memory attribution", async () => {
    const item = await t.run(ctx => ctx.db.query("cases").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "DC-2026-0412")).unique());
    const facts = (await factsOf(t)).filter(fact => fact.caseId === item!._id);
    expect(facts.find(fact => fact.key === "COMPLETION")?.value).toEqual({ at: utc("2026-11-02T06:00") });
    expect(facts.find(fact => fact.key === "INTERVAL" && (fact.value as { kind: string }).kind === "CUSTOMS_HOLD")?.value).toMatchObject({ verified: true, source: "PORTAL" });
    const extraction = await t.run(async ctx => {
      const doc = (await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "DOC-SOF-ASTERVALE")).unique())!;
      return ctx.db.query("extractions").withIndex("by_document", q => q.eq("ns", "demo").eq("documentId", doc._id)).unique();
    });
    expect(extraction?.fields).toMatchObject({ mappedRows: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
    expect((extraction?.fields as { rows: unknown[] }).rows).toHaveLength(9);
    expect((await stepsOf(t)).some(step => step.caseId === item!._id && step.memoryRefs.includes("P-CUSTOMS-PORTAL-FIRST"))).toBe(true);
  });

  test("T-07/T-11/T-14: no portal before approval, K-1 Ops and exactly A-1 Trader / A-2 Controller", async () => {
    expect(prepareRequests.flatMap(request => request.tools ?? []).map(entry => (entry as { name: string }).name)).not.toContain("search_customs_portal");
    const asks = await t.run(ctx => ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
    expect(asks.map(ask => [ask.code, ask.kind, ask.role, ask.amountAtRiskCents])).toEqual([
      ["K-1", "CONFIRM_FACT", "ops", 900_000],
      ["A-1", "COMMERCIAL_DECISION", "trader", 9_360_000],
      ["A-2", "PAYMENT_APPROVAL", "controller", 11_015_000],
    ]);
    expect(asks.find(ask => ask.code === "K-1")).toMatchObject({ status: "OPEN", question: "Confirm customs hold 3 Oct 17:00–4 Oct 05:00? $9,000 of Litoral Grãos recovery depends on it." });
    expect(asks.find(ask => ask.code === "K-1")!.remindersSent).toBeGreaterThan(0);
    const answers = await t.run(ctx => ctx.db.query("auditEvents").withIndex("by_ns_seq", q => q.eq("ns", "demo")).filter(q => q.eq(q.field("type"), "ASK_ANSWERED")).collect());
    expect(answers).toHaveLength(2);
    expect(answers.every(event => event.origin === "SCRIPTED_RESPONDER")).toBe(true);
  });

  test("T-09: exact October accruals and November true-up; recovery follows scripted commercial decision", async () => {
    const result = await t.run(async ctx => {
      const entries = (await ctx.db.query("journalEntries").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).filter(entry => entry.origin !== "HISTORY_IMPORT");
      return Promise.all(entries.map(async entry => {
        const item = entry.caseId ? await ctx.db.get(entry.caseId) : null;
        const lines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("ns", "demo").eq("entryId", entry._id)).collect();
        expect(lines.filter(line => line.side === "DEBIT").reduce((sum, line) => sum + line.cents, 0)).toBe(lines.filter(line => line.side === "CREDIT").reduce((sum, line) => sum + line.cents, 0));
        return { code: item?.code, kind: entry.kind, period: entry.periodCode, cents: lines.filter(line => line.side === "DEBIT").reduce((sum, line) => sum + line.cents, 0) };
      }));
    });
    expect(result.filter(entry => entry.kind === "ACCRUAL" && entry.period === "2026-10")).toEqual(expect.arrayContaining([
      { code: "DC-2026-0398", kind: "ACCRUAL", period: "2026-10", cents: 3_600_000 },
      { code: "DC-2026-0405", kind: "ACCRUAL", period: "2026-10", cents: 3_000_000 },
      { code: "DC-2026-0412", kind: "ACCRUAL", period: "2026-10", cents: 8_000_000 },
    ]));
    expect(result).toContainEqual({ code: "DC-2026-0412", kind: "ACCRUAL_TRUEUP", period: "2026-11", cents: 3_000_000 });
    expect(result).toContainEqual({ code: "DC-2026-0412", kind: "AR_RECOVERY", period: "2026-11", cents: 9_060_000 });
    // V06 responder approves the unedited proposal. Controller line editing is delivered in V09.
    expect(result.filter(entry => entry.kind === "AP")).toEqual([{ code: "DC-2026-0412", kind: "AP", period: "2026-12", cents: 11_015_000 }]);
  });

  test("T-16: injection ignored; AP follows A-2; model step text carries no amounts", async () => {
    const steps = await stepsOf(t);
    expect(steps.some(step => step.title === "Ignored instructions inside a document")).toBe(true);
    for (const step of steps) expect([step.title, step.observation, step.check, step.conclusion].filter(Boolean).join(" ")).not.toMatch(/\$|USD|EUR/);
    const audit = await t.run(ctx => ctx.db.query("auditEvents").withIndex("by_ns_seq", q => q.eq("ns", "demo")).collect());
    const approval = audit.find(event => event.type === "ASK_ANSWERED" && event.entityId === "A-2");
    const ap = audit.find(event => event.type === "JOURNAL_POSTED" && (event.after as { kind?: string } | undefined)?.kind === "AP");
    expect(approval).toBeDefined();
    expect(ap).toBeDefined();
    expect(ap!.seq).toBeGreaterThan(approval!.seq);
    expect(await t.query(api.audit.verifyChain, { ns: "demo" })).toMatchObject({ ok: true });
  });
});

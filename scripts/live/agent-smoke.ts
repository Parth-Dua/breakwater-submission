// Live agent checks (V06 §10). Real Claude, isolated in-memory backend (never a shared deployment).
//   npm run test:live                      quick: one real NOR task + extraction (connectivity, parameters, cache)
//   BREAKWATER_LIVE_FULL=1 npm run test:live   full: every task kind on the demo stories; records fixtures/agent-transcripts
// Results are written to fixtures/agent-transcripts/live-report.json (no secrets, no document bytes).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, expect, test } from "vitest";
import { agentModel, type MessagesClient } from "../../convex/node/claude";
import { agentWorld, attach, recordingClient, replayClient, releaseNext, runQueued, setClaudeClient, setSimNow, type Transcript, type TranscriptTurn } from "../../tests/v2/helpers/agentWorld";
import { prepareStory, stormStory, type TaskRun } from "../../tests/v2/helpers/stories";

// The key is read from .env.local into this process only; it is never printed or written.
if (!process.env.ANTHROPIC_API_KEY) {
  const line = readFileSync(".env.local", "utf8").split("\n").find(entry => entry.startsWith("ANTHROPIC_API_KEY="));
  if (line) process.env.ANTHROPIC_API_KEY = line.slice("ANTHROPIC_API_KEY=".length).trim().replace(/^"|"$/g, "");
}
const FULL = process.env.BREAKWATER_LIVE_FULL === "1";
const REPLAY_PREPARE = FULL && process.env.BREAKWATER_LIVE_REPLAY_PREPARE === "1";
const OUT = "fixtures/agent-transcripts";
const sdk = new Anthropic({ maxRetries: 0, timeout: 60_000 });
const real: MessagesClient = { create: (params, options) => sdk.beta.messages.create(params, options) };

type Row = { story: string; kind: string; state: string; ms: number; turns: number; tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; model: string; error?: string };
const rows: Row[] = [];
let verified = false;

/** Runs a story and turns its task markers into report rows (a task's turns are those recorded until the next task starts). */
async function tracked(t: Awaited<ReturnType<typeof agentWorld>>, turns: TranscriptTurn[], drive: (hooks: { onTask: (run: TaskRun) => void }) => Promise<void>) {
  const marks: { run: TaskRun; from: number; at: number }[] = [];
  await drive({ onTask: run => { console.info(`[live] ${run.story}: ${run.kind}`); marks.push({ run, from: turns.length, at: Date.now() }); } });
  const ended = Date.now();
  for (const [index, { run, from, at }] of marks.entries()) {
    const next = marks[index + 1];
    const slice = turns.slice(from, next?.from ?? turns.length);
    const task = await t.run(ctx => ctx.db.get(run.taskId));
    rows.push({
      story: run.story, kind: run.kind, state: task?.state ?? "?", ms: (next?.at ?? ended) - at, turns: slice.length,
      tokensIn: slice.reduce((sum, turn) => sum + turn.response.usage.input_tokens, 0), tokensOut: slice.reduce((sum, turn) => sum + turn.response.usage.output_tokens, 0),
      cacheRead: slice.reduce((sum, turn) => sum + (turn.response.usage.cache_read_input_tokens ?? 0), 0), cacheWrite: slice.reduce((sum, turn) => sum + (turn.response.usage.cache_creation_input_tokens ?? 0), 0),
      model: slice.at(-1)?.response.model ?? "", ...(task?.error ? { error: task.error } : {}),
    });
  }
}

function save(name: string, turns: TranscriptTurn[]) {
  mkdirSync(OUT, { recursive: true });
  const transcript: Transcript = { name, model: agentModel(), recordedAt: new Date().toISOString(), turns };
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(transcript, null, 1));
}

afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/live-report${FULL ? "" : "-quick"}.json`, JSON.stringify({ model: agentModel(), full: FULL, verified, prepareMode: REPLAY_PREPARE ? "RECORDED_REPLAY" : "LIVE", ranAt: new Date().toISOString(), rows }, null, 1));
  console.table(rows.map(({ error, ...row }) => ({ ...row, error: error?.slice(0, 60) ?? "" })));
  setClaudeClient(null);
});

test.skipIf(FULL)("quick: a real NOR task on Kestrel succeeds with postconditions met", async () => {
  const t = await agentWorld({ pdfs: true });
  const turns: TranscriptTurn[] = [];
  setClaudeClient(recordingClient(real, turns));
  await attach(t, "SSZ-KESTREL-2026-10");
  await setSimNow(t, Date.UTC(2026, 8, 30, 18));
  await tracked(t, turns, async ({ onTask }) => {
    for (let i = 0; i < 3; i++) { await releaseNext(t); await runQueued(t, task => onTask({ taskId: task._id, kind: task.kind, story: "quick" })); }
  });
  expect(rows.map(row => row.state)).toEqual(["SUCCEEDED", "SUCCEEDED", "SUCCEEDED"]);
  expect(rows.slice(1).some(row => row.cacheRead > 0)).toBe(true);
  const facts = await t.run(async ctx => (await ctx.db.query("facts").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).filter(fact => !fact.supersededBy).map(fact => fact.key));
  expect(facts).toEqual(expect.arrayContaining(["NOR_TENDERED", "NOR_VALIDITY", "LAYTIME_START_PAYABLE", "LAYTIME_START_RECOVERABLE"]));
  verified = true;
}, 20 * 60_000);

/** What the run produced, for the report (read back from the backend, not from model text). */
async function dumpState(t: Awaited<ReturnType<typeof agentWorld>>, label: string) {
  const state = await t.run(async ctx => {
    const agentCases = (await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).filter(item => item.origin !== "HISTORY_IMPORT");
    const entries = (await ctx.db.query("journalEntries").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).filter(entry => entry.origin !== "HISTORY_IMPORT");
    const journals = [];
    for (const entry of entries) {
      const lines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("ns", "demo").eq("entryId", entry._id)).collect();
      journals.push({ code: entry.code, kind: entry.kind, period: entry.periodCode, memo: entry.memo, authority: entry.authority.kind, lines: lines.map(line => `${line.side === "DEBIT" ? "Dr" : "Cr"} ${line.account} ${line.cents}`) });
    }
    const steps = (await ctx.db.query("agentSteps").withIndex("by_ns", q => q.eq("ns", "demo")).collect());
    return {
      cases: agentCases.map(item => ({ code: item.code, status: item.status, statusLine: item.statusLine, payable: item.payable?.totalCents, recoverable: item.recoverable?.totalCents, disputed: item.disputedCents })),
      asks: (await ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).map(ask => ({ code: ask.code, role: ask.role, kind: ask.kind, question: ask.question, status: ask.status, amountAtRiskCents: ask.amountAtRiskCents, reminders: ask.remindersSent, answer: ask.answer?.optionId })),
      journals,
      filings: (await ctx.db.query("filings").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).filter(filing => filing.origin !== "HISTORY_IMPORT").map(filing => ({ kind: filing.kind, cents: filing.cents, authority: filing.authority.kind })),
      steps: steps.map(step => ({ case: step.caseId ? agentCases.find(item => item._id === step.caseId)?.code : null, status: step.status, title: step.title, deltaCents: step.deltaCents, memoryRefs: step.memoryRefs, evidence: step.evidence.length, tools: step.toolCalls.map(call => `${call.tool}${call.allowed ? "" : "(denied)"}`) })),
      tasks: (await ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).map(task => ({ kind: task.kind, state: task.state, error: task.error })),
      audit: Object.entries((await ctx.db.query("auditEvents").withIndex("by_ns_seq", q => q.eq("ns", "demo")).collect()).reduce<Record<string, number>>((acc, event) => ({ ...acc, [event.type]: (acc[event.type] ?? 0) + 1 }), {})),
    };
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/live-state-${label}.json`, JSON.stringify(state, null, 1));
  return state;
}

test.skipIf(!FULL)("full: every task kind on the demo stories, real Claude; transcripts recorded", async () => {
  const t = await agentWorld({ pdfs: true });
  const prepareTurns: TranscriptTurn[] = [], stormTurns: TranscriptTurn[] = [];
  if (REPLAY_PREPARE) {
    // Credit-saving setup only. Replayed tokens/timings are never counted as live evidence.
    const prepare = replayClient(JSON.parse(readFileSync(`${OUT}/prepare.json`, "utf8")) as Transcript);
    setClaudeClient(prepare);
    await prepareStory(t);
    expect(prepare.remaining()).toBe(0);
  } else {
    setClaudeClient(recordingClient(real, prepareTurns));
    try { await tracked(t, prepareTurns, hooks => prepareStory(t, hooks)); } finally { save("prepare", prepareTurns); await dumpState(t, "prepare"); }
  }
  setClaudeClient(recordingClient(real, stormTurns));
  let state: Awaited<ReturnType<typeof dumpState>>;
  try { await tracked(t, stormTurns, hooks => stormStory(t, hooks)); } finally { save("storm", stormTurns); state = await dumpState(t, "storm"); }
  const kinds = new Set(rows.map(row => row.kind));
  expect([...kinds].sort()).toEqual(["AIS_UPDATE", "ASK_ANSWERED", "DEADLINE_CHECK", "DOCUMENT_RECEIVED", "FLEET_SCAN", "MONTH_END", "PORT_NOTICE"]);
  expect(rows.filter(row => !["SUCCEEDED", "WAITING_HUMAN"].includes(row.state))).toEqual([]);
  expect(rows.slice(1).some(row => row.cacheRead > 0)).toBe(true);
  expect(state!.asks.map(ask => [ask.code, ask.role, ask.amountAtRiskCents])).toEqual([["K-1", "ops", 900_000], ["A-1", "trader", 9_360_000], ["A-2", "controller", 11_015_000]]);
  const asterJournals = state!.journals.filter(entry => entry.memo.includes("DC-2026-0412"));
  expect(asterJournals.map(entry => [entry.kind, entry.period, entry.lines[0]])).toEqual([
    ["ACCRUAL", "2026-10", "Dr 5100 8000000"],
    ["AR_RECOVERY", "2026-11", "Dr 1200 9060000"],
    ["ACCRUAL_TRUEUP", "2026-11", "Dr 5100 3000000"],
    ["ACCRUAL_REVERSAL", "2026-12", "Dr 2150 11000000"],
    ["AP", "2026-12", "Dr 5100 11015000"],
  ]);
  verified = true;
}, 120 * 60_000);

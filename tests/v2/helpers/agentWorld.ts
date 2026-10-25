// Agent test driver: an isolated in-memory backend with the demo world, world events released one at a time and
// queued tasks run through the real runtime (node/agent.runTask) with an injected Claude client.
import { readFileSync } from "node:fs";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { setMessagesClientForTests, type MessagesClient } from "../../../convex/node/claude";
import { enqueueDueDeadlineChecks } from "../../../convex/orchestrator";
import { sendDueReminders } from "../../../convex/asks";
import { attachScript, nextUnreleased, releaseEvent } from "../../../convex/world/release";
import manifest from "../../../fixtures/documents/manifest.json";
import { testBackend } from "./convex";

export type T = ReturnType<typeof testBackend>;
const NS = "demo";
type Entry = { ns: string; code: string; file: string; caseCode?: string };
const DEMO_DOCS = (manifest as Entry[]).filter(entry => entry.ns === NS && !entry.caseCode);

/** World with all demo-script documents. `pdfs: true` stores the real PDF bytes (live runs send them to Claude). */
export async function agentWorld(opts: { pdfs: boolean }) {
  const t = testBackend();
  await t.action(internal.world.import.importAll, { ns: NS });
  const items = await t.run(async ctx => Promise.all(DEMO_DOCS.map(async entry => ({
    code: entry.code,
    storageId: await ctx.storage.store(new Blob([opts.pdfs ? readFileSync(entry.file) : entry.code], { type: "application/pdf" })),
  }))));
  for (let start = 0; start < items.length; start += 25) await t.mutation(internal.world.importDocuments.register, { ns: NS, items: items.slice(start, start + 25) });
  return t;
}

export async function attach(t: T, scriptCode: string) {
  await t.run(async ctx => { await attachScript(ctx, NS, scriptCode); });
}

/** Sets the sim clock (replaying an earlier story starts before its first event, as sim.runUntil does). */
export async function setSimNow(t: T, at: number) {
  await t.run(async ctx => {
    const clock = (await ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", NS)).first())!;
    await ctx.db.patch(clock._id, { simNow: at });
  });
}

/** Releases the next scripted event (advancing sim time like the clock does). Returns its type, or null when done. */
export async function releaseNext(t: T, until = Number.MAX_SAFE_INTEGER): Promise<{ type: string; at: number; payload: Record<string, unknown> } | null> {
  return t.run(async ctx => {
    const next = await nextUnreleased(ctx, NS);
    if (!next || next.scheduledAt > until) return null;
    const clock = (await ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", NS)).first())!;
    const simNow = Math.max(clock.simNow, next.scheduledAt);
    await ctx.db.patch(clock._id, { simNow });
    await sendDueReminders(ctx, NS, simNow);
    await enqueueDueDeadlineChecks(ctx, NS, simNow);
    await releaseEvent(ctx, next);
    return { type: next.type, at: next.scheduledAt, payload: next.payload as Record<string, unknown> };
  });
}

export async function queued(t: T): Promise<{ _id: Id<"agentTasks">; kind: string }[]> {
  return t.run(async ctx => (await ctx.db.query("agentTasks").withIndex("by_state", q => q.eq("ns", NS).eq("state", "QUEUED")).collect()).sort((a, b) => a._creationTime - b._creationTime).map(task => ({ _id: task._id, kind: task.kind })));
}

/** Runs every queued task (and tasks they cause) to completion. Returns the tasks run, in order. */
export async function runQueued(t: T, onTask?: (task: { _id: Id<"agentTasks">; kind: string }) => void) {
  const ran: Id<"agentTasks">[] = [];
  for (let guard = 0; guard < 50; guard++) {
    const [task] = await queued(t);
    if (!task) break;
    onTask?.(task);
    await t.action(internal.node.agent.runTask, { taskId: task._id });
    ran.push(task._id);
  }
  return ran;
}

/** Test seed (labeled): the procedure V10 learns from Kestrel, inserted ACTIVE so V06 can test capability grants. */
export async function seedCustomsProcedure(t: T) {
  await t.run(async ctx => {
    await ctx.db.insert("memoryItems", {
      ns: NS, origin: "SYSTEM", code: "P-CUSTOMS-PORTAL-FIRST", kind: "PROCEDURE", status: "ACTIVE", title: "Check the customs portal before asking Ops (test seed)",
      payload: { type: "PROCEDURE", procedure: { dslVersion: 2, trigger: { intervalKind: "CUSTOMS_HOLD", missingEvidence: "CUSTOMS_RELEASE", ports: "ALL" }, grants: [{ system: "CUSTOMS_PORTAL", scope: "CASE_VESSEL_AND_INTERVAL" }], steps: [{ op: "SEARCH_SOURCE", system: "CUSTOMS_PORTAL", match: { vessel: true, interval: true } }, { op: "VERIFY_DOCUMENT", checks: ["SAME_VESSEL", "COVERS_INTERVAL"] }, { op: "MARK_VERIFIED" }, { op: "ESCALATE_IF_MISSING", role: "ops" }] } },
      scope: { kind: "ALL" }, version: 1, usedIn: [], createdAt: 0,
    });
  });
}

// ---------------------------------------------------------------- Claude clients
export type TranscriptTurn = { tools: string[]; format: boolean; response: BetaMessage };
export type Transcript = { name: string; model: string; recordedAt: string; turns: TranscriptTurn[] };

/** Replays recorded responses in order; fails loudly if the runtime asks for more turns than were recorded. */
export function replayClient(transcript: Transcript): MessagesClient & { remaining: () => number; requests: MessageCreateParamsNonStreaming[] } {
  let index = 0;
  const requests: MessageCreateParamsNonStreaming[] = [];
  return {
    requests,
    remaining: () => transcript.turns.length - index,
    async create(params) {
      requests.push(params);
      const turn = transcript.turns[index++];
      if (!turn) throw Object.assign(new Error(`Transcript ${transcript.name} exhausted at turn ${index}`), { status: 400 });
      const offered = (params.tools ?? []).map(tool => (tool as { name: string }).name);
      if (turn.format !== Boolean(params.output_config?.format) || JSON.stringify(turn.tools) !== JSON.stringify(offered)) throw Object.assign(new Error(`Transcript ${transcript.name} request mismatch at turn ${index}`), { status: 400 });
      return turn.response;
    },
  };
}

/** Wraps a real client and records responses (requests reduced to the offered tool names; no document bytes). */
export function recordingClient(inner: MessagesClient, turns: TranscriptTurn[]): MessagesClient {
  return {
    async create(params, options) {
      const response = await inner.create(params, options);
      // Persist tool proposals and final text only; never retain model thinking in fixtures.
      const sanitized = { ...response, content: response.content.filter(block => block.type !== "thinking" && block.type !== "redacted_thinking") };
      turns.push({ tools: (params.tools ?? []).map(tool => (tool as { name: string }).name), format: Boolean(params.output_config?.format), response: sanitized });
      return response;
    },
  };
}

export function setClaudeClient(client: MessagesClient | null) { setMessagesClientForTests(client); }

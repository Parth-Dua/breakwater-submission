"use node";
// Agent run loop (ARCHITECTURE §5.2). Claude chooses tools; every tool is deterministic and capability-checked.
import type { BetaMessageParam, BetaToolResultBlockParam, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { callClaude, ModelUnavailable, TaskBudgetExceeded, type Usage } from "./claude";
import { readDocument } from "./extract";
import { AGENT_SYSTEM, EFFORT, taskPrompt, type TaskKind } from "./prompts/agent";
import { TOOL_DEFINITIONS, toolsForKind, validateInput } from "./tools/definitions";
import { toolOffered, TOOL_SYSTEMS, type Capability } from "../../src/domain/capabilities";
import { checkPostconditions, type CaseSnapshot } from "../../src/domain/postconditions";

const LEASE_MS = 90_000;
const MAX_TOOL_CALLS = 12;      // excluding record_step, which only streams steps to the UI
const MAX_STEP_CALLS = 24;
const MAX_TURNS = 30;
const TASK_BUDGET_MS = 4 * 60_000;
const RESULT_CHARS = 16_000;

type Ref = { type: "query" | "mutation"; fn: unknown };
const t = internal.agent.tools;
const DISPATCH: Record<string, Ref> = {
  record_step: { type: "mutation", fn: t.recordStep },
  get_case_snapshot: { type: "query", fn: t.snapshot },
  list_fleet: { type: "query", fn: t.listFleet },
  list_open_cases: { type: "query", fn: t.listOpenCases },
  open_case: { type: "mutation", fn: t.openCase },
  search_mailbox: { type: "query", fn: t.searchMailboxTool },
  get_ais: { type: "query", fn: t.getAis },
  check_nor: { type: "mutation", fn: t.checkNor },
  convert_local_times: { type: "query", fn: t.convertLocalTimes },
  record_intervals: { type: "mutation", fn: t.recordIntervals },
  search_customs_portal: { type: "query", fn: t.searchCustomsPortalTool },
  verify_hold: { type: "mutation", fn: t.verifyHold },
  get_contract_terms: { type: "query", fn: t.contractTermsTool },
  compute_statement: { type: "mutation", fn: t.computeStatementTool },
  reconcile_invoice: { type: "mutation", fn: t.reconcileInvoiceTool },
  post_accrual: { type: "mutation", fn: t.postAccrual },
  post_ap: { type: "mutation", fn: t.postAp },
  file_recovery: { type: "mutation", fn: t.fileRecovery },
  create_ask: { type: "mutation", fn: t.createAskTool },
  search_memory: { type: "query", fn: t.searchMemory },
};

/** Times go to the model as ISO strings; it never handles epoch milliseconds. */
const TIME_KEY = /(At|^eta|^simNow|^from|^to|^at)$/;
export function present(value: unknown, key = ""): unknown {
  if (typeof value === "number" && TIME_KEY.test(key) && value > 1e12 && value < 4e12) return new Date(value).toISOString().replace(":00.000Z", "Z");
  if (Array.isArray(value)) return value.map(item => present(item, key === "at" ? "at" : ""));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, item]) => [k, present(item, k)]));
  return value;
}
const toMs = (iso: unknown) => { const at = Date.parse(String(iso)); return Number.isFinite(at) ? at : NaN; };

function prepareInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name === "get_ais" && Array.isArray(input.at)) return { ...input, at: input.at.map(toMs).filter(Number.isFinite) };
  if (name === "search_customs_portal") return { ...input, from: toMs(input.from), to: toMs(input.to) };
  return input;
}

function controlsFor(ctx: ActionCtx, run: Run) {
  return { deadlineAt: run.deadlineAt, beforeAttempt: async () => {
    if (!await ctx.runMutation(internal.agent.tools.renewLease, { taskId: run.taskId, token: run.token, leaseMs: LEASE_MS })) throw new Error("Task lease is no longer held");
  } };
}

type Run = { taskId: Id<"agentTasks">; token: string; usage: Usage; model?: string; needsReview: string[]; toolCalls: number; stepCalls: number; deadlineAt: number };

async function execute(ctx: ActionCtx, run: Run, capabilities: Capability[], offered: Set<string>, block: BetaToolUseBlock): Promise<BetaToolResultBlockParam> {
  const started = Date.now();
  const input = (block.input ?? {}) as Record<string, unknown>;
  const reply = (content: unknown, isError = false): BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(present(content)).slice(0, RESULT_CHARS), ...(isError ? { is_error: true } : {}) });
  const log = (allowed: boolean, summary: string, capability?: string) =>
    ctx.runMutation(internal.agent.tools.appendToolCall, { taskId: run.taskId, token: run.token, log: { tool: block.name, allowed, ms: Date.now() - started, summary: summary.slice(0, 160), ...(capability ? { capability } : {}) } });
  // Security invariant 4: a tool not offered for this run is denied (and audited), even if the model names it.
  if (!offered.has(block.name) || !toolOffered(capabilities, block.name)) {
    await log(false, "Denied: not available for this run");
    return reply({ error: "CAPABILITY_DENIED", message: "That tool is not available for this run" }, true);
  }
  const definition = TOOL_DEFINITIONS.find(tool => tool.name === block.name)!;
  const invalid = validateInput(definition.input_schema, input);
  if (invalid) { await log(true, `Invalid input: ${invalid}`); return reply({ error: "INVALID_INPUT", message: invalid }, true); }
  if (block.name === "record_step") { if (++run.stepCalls > MAX_STEP_CALLS) return reply({ error: "Step budget exhausted; finish now." }, true); }
  else if (++run.toolCalls > MAX_TOOL_CALLS) return reply({ error: "Tool budget exhausted; finish with one sentence." }, true);
  try {
    let result: unknown;
    if (block.name === "read_document") {
      const extraction = await readDocument(ctx, run.taskId, run.token, { caseCode: input.caseCode as string, documentCode: String(input.documentCode) }, controlsFor(ctx, run));
      if (extraction.usage) { run.usage.tokensIn += extraction.usage.tokensIn; run.usage.tokensOut += extraction.usage.tokensOut; run.usage.cacheRead += extraction.usage.cacheRead; run.usage.cacheWrite += extraction.usage.cacheWrite; }
      if (extraction.rejected.length) run.needsReview.push(`${extraction.documentCode}: ${extraction.rejected.join(", ")} not verified`);
      else run.needsReview = run.needsReview.filter(item => !item.startsWith(`${extraction.documentCode}:`));
      // Instruction-like text in a document is shown as ignored on the step (T-16), never acted on.
      if (extraction.ignoredInstructions.length) {
        await ctx.runMutation(internal.agent.tools.recordStep, { taskId: run.taskId, token: run.token, input: { status: "DONE", title: "Ignored instructions inside a document", observation: `Ignored: "${extraction.ignoredInstructions[0].slice(0, 120)}"`, conclusion: "Documents cannot approve or change routing", evidenceDocs: [extraction.documentCode], memoryRefs: [] } });
      }
      const { usage: _usage, ...rest } = extraction;
      void _usage;
      result = rest;
    } else {
      const ref = DISPATCH[block.name];
      const args = { taskId: run.taskId, token: run.token, input: prepareInput(block.name, input) };
      result = ref.type === "query" ? await ctx.runQuery(ref.fn as never, args as never) : await ctx.runMutation(ref.fn as never, args as never);
    }
    const capabilityId = (result as { capabilityId?: string } | null)?.capabilityId;
    const memory = capabilityId?.match(/^memory:([^:]+):/)?.[1];
    if (memory) await ctx.runMutation(internal.agent.tools.noteMemoryUse, { taskId: run.taskId, token: run.token, memoryCode: memory });
    await log(true, summarize(block.name, result), capabilityId ?? (TOOL_SYSTEMS[block.name] ? `base:${TOOL_SYSTEMS[block.name][0]}` : undefined));
    return reply(result);
  } catch (error) {
    const data = (error as { data?: { code?: string; message?: string } }).data;
    const message = data?.message ?? (error as Error).message ?? "Tool failed";
    if (data?.code === "STALE_VERSION" && /lease/i.test(message)) throw error;
    await log(true, `Error: ${message}`);
    return reply({ error: data?.code ?? "TOOL_ERROR", message: message.slice(0, 400) }, true);
  }
}

function summarize(name: string, result: unknown) {
  const r = result as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return name;
  if (Array.isArray(r)) return `${r.length} rows`;
  for (const key of ["askCode", "caseCode", "action", "reason", "version", "valid", "verified", "posted", "filed"]) if (key in r) return `${key}: ${String(r[key])}`;
  return name;
}

export const runTask = internalAction({
  args: { taskId: v.id("agentTasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    const lease = await ctx.runMutation(internal.agent.tools.leaseTask, { taskId, leaseMs: LEASE_MS });
    if (!lease) return null;
    const kind = lease.kind as TaskKind;
    const run: Run = { taskId, token: lease.token, usage: { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }, needsReview: [], toolCalls: 0, stepCalls: 0, deadlineAt: Date.now() + TASK_BUDGET_MS };
    const finish = (state: "SUCCEEDED" | "NEEDS_REVIEW" | "FAILED", error?: string) =>
      ctx.runMutation(internal.agent.tools.finishTask, { taskId, token: lease.token, state, ...(error ? { error } : {}), ...(run.model ? { model: run.model } : {}), tokensIn: run.usage.tokensIn, tokensOut: run.usage.tokensOut, cacheRead: run.usage.cacheRead, cacheWrite: run.usage.cacheWrite });
    const started = Date.now();
    try {
      // The lease is real work already in progress; publish it before waiting on the provider.
      const title: Record<TaskKind, string> = { FLEET_SCAN: "Scan upcoming voyages", AIS_UPDATE: "Check vessel positions", DOCUMENT_RECEIVED: "Review received document", PORT_NOTICE: "Review port notice", MONTH_END: "Review month-end accruals", ASK_ANSWERED: "Apply the answer", DEADLINE_CHECK: "Check recovery deadline" };
      await ctx.runMutation(internal.agent.tools.recordStep, { taskId, token: lease.token, input: { status: "RUNNING", title: title[kind], evidenceDocs: [], memoryRefs: [] } });
      const before: CaseSnapshot = await ctx.runQuery(internal.agent.tools.postconditionSnapshot, { taskId });
      const event = lease.event as { type: string; payload: Record<string, unknown> } | null;
      // AIS points are summarized by get_ais; the event itself only says which vessel.
      const eventForPrompt = event && { type: event.type, payload: Object.fromEntries(Object.entries(event.payload).filter(([key]) => key !== "points")) };
      const messages: BetaMessageParam[] = [{ role: "user", content: taskPrompt(kind, { ...(lease.caseCode ? { caseCode: lease.caseCode } : {}), event: eventForPrompt, ask: lease.ask, ...(before.documentKind ? { documentKind: before.documentKind } : {}) }) }];
      const allowedNames = toolsForKind(kind);
      let repaired = false;
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (Date.now() - started > TASK_BUDGET_MS) { await finish("NEEDS_REVIEW", "Task time budget exceeded"); return null; }
        if (!await ctx.runMutation(internal.agent.tools.renewLease, { taskId, token: lease.token, leaseMs: LEASE_MS })) return null;
        // Capabilities are re-resolved every turn: a procedure can start to match once an interval is recorded.
        const { capabilities }: { capabilities: Capability[] } = await ctx.runQuery(internal.agent.tools.capabilitiesForTask, { taskId });
        const tools = TOOL_DEFINITIONS.filter(tool => allowedNames.has(tool.name) && toolOffered(capabilities, tool.name));
        const offered = new Set(tools.map(tool => tool.name));
        const response = await callClaude({ ...controlsFor(ctx, run), system: AGENT_SYSTEM, tools, messages, effort: EFFORT[kind] });
        run.usage.tokensIn += response.usage.tokensIn; run.usage.tokensOut += response.usage.tokensOut;
        run.usage.cacheRead += response.usage.cacheRead; run.usage.cacheWrite += response.usage.cacheWrite;
        run.model = response.model;
        messages.push({ role: "assistant", content: response.message.content });
        if (response.message.stop_reason === "refusal") { await finish("NEEDS_REVIEW", "The model declined this task"); return null; }
        const calls = response.message.content.filter((block): block is BetaToolUseBlock => block.type === "tool_use");
        if (calls.length) {
          const results: BetaToolResultBlockParam[] = [];
          for (const call of calls) results.push(await execute(ctx, run, capabilities, offered, call));
          messages.push({ role: "user", content: results });
          continue;
        }
        if (response.message.stop_reason === "max_tokens") { await finish("NEEDS_REVIEW", "Model output was cut off"); return null; }
        const after: CaseSnapshot = await ctx.runQuery(internal.agent.tools.postconditionSnapshot, { taskId });
        const check = checkPostconditions(kind, before, after);
        if (!check.ok && !repaired) {
          repaired = true;
          messages.push({ role: "user", content: `Not done yet. Still missing: ${check.missing.join("; ")}. Finish these with tools, or ask if a fact cannot be verified.` });
          continue;
        }
        if (!check.ok || run.needsReview.length) { await finish("NEEDS_REVIEW", [...check.missing, ...run.needsReview].join("; ")); return null; }
        await finish("SUCCEEDED");
        return null;
      }
      await finish("NEEDS_REVIEW", "Turn limit reached");
    } catch (error) {
      if (error instanceof TaskBudgetExceeded) await finish("NEEDS_REVIEW", error.message);
      else if (error instanceof ModelUnavailable) await finish("FAILED", error.message);
      else await finish("FAILED", `Agent error: ${(error as Error).message}`.slice(0, 500));
    }
    return null;
  },
});

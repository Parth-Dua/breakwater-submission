import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { v } from "convex/values";
import { MAX_ATTEMPTS, MAX_PROVIDER_TURNS, MAX_TOOL_STEPS, hasInstructionText, type AgentBlock, type AgentMessage } from "../../src/lib/agent-schemas";
import { getClaimCalculation } from "../financeCore";
import { evaluateRun } from "./procedures";
import { ensureOpsTask, executeTool } from "./toolExecution";
const leaseArgs = { runId: v.id("agentRuns"), token: v.string() };
async function leased(ctx: MutationCtx, runId: Id<"agentRuns">, token: string) {
  const run = await ctx.db.get(runId);
  if (!run || run.state !== "RUNNING" || run.leaseToken !== token || (run.leaseUntil ?? 0) < Date.now()) throw new Error("STALE_WORKFLOW_LEASE");
  const claim = await ctx.db.get(run.claimId);
  if (claim?.revision !== run.revision) throw new Error("STALE_CLAIM_REVISION");
  return run;
}
async function audit(ctx: MutationCtx, run: Doc<"agentRuns">, eventType: string, extra: Record<string, string | number | boolean> = {}) {
  const fresh=await ctx.db.get(run._id);
  await ctx.db.insert("auditEvents", { scenarioId: run.scenarioId, synthetic: true, actor: "internal:workflow", actorRole:"finance_agent", eventType, entityType: "agentRun", entityId: run._id, correlationId: run.correlationId, at: Date.now(), details: { claimId: run.claimId, revision: run.revision, beforeState:eventType==="INVESTIGATION_QUEUED"?"NOT_CREATED":run.state,afterState:fresh?.state??"MISSING",...extra } });
}
export async function startRun(ctx: MutationCtx, claimId: Id<"claims">, schedule = true) {
  const claim = await ctx.db.get(claimId); if (!claim) throw new Error("Claim not found");
  const existing = await ctx.db.query("agentRuns").withIndex("by_claim", q => q.eq("claimId", claimId)).filter(q => q.eq(q.field("revision"), claim.revision)).unique();
  if (existing) return existing._id;
  const id = await ctx.db.insert("agentRuns", { scenarioId: claim.scenarioId, synthetic: true, claimId, revision: claim.revision, state: "QUEUED", step: 0, attempt: 0, providerTurns: 0, correlationId: `investigate:${claimId}:${claim.revision}`, toolOutcomes: [], messages: JSON.stringify([{ role: "user", content: [{ type: "text", text: `Investigate synthetic claim ${claim.claimCode}, revision ${claim.revision}. Use tools to read source records, preserve uncertainty, and propose the correct next action. Start with get_claim_snapshot.` }] }]), pendingTools: [], pendingResults: [], updatedAt: Date.now() });
  await ctx.db.patch(claimId, { status: "INVESTIGATING", updatedAt: Date.now() });
  await audit(ctx, (await ctx.db.get(id))!, "INVESTIGATION_QUEUED");
  if (schedule) await ctx.scheduler.runAfter(0, internal.internal.agent.investigate, { runId: id });
  return id;
}
export const start = internalMutation({ args: { claimId: v.id("claims"), schedule: v.optional(v.boolean()) }, returns: v.id("agentRuns"), handler: (ctx, args) => startRun(ctx, args.claimId, args.schedule ?? true) });
export const getRun = internalQuery({ args: { runId: v.id("agentRuns") }, returns: v.union(v.null(), schema.doc("agentRuns")), handler: (ctx, args) => ctx.db.get(args.runId) });
export const inspect = internalQuery({ args: { claimId: v.id("claims") }, returns: v.string(), handler: async (ctx, args) => {
  const data = await getClaimCalculation(ctx, args.claimId), runs = await ctx.db.query("agentRuns").withIndex("by_claim", q => q.eq("claimId", args.claimId)).collect();
  const tasks = await ctx.db.query("workItems").withIndex("by_claim", q => q.eq("claimId", args.claimId)).collect(), journals = await ctx.db.query("journalEntries").withIndex("by_claim", q => q.eq("claimId", args.claimId)).collect();
  return JSON.stringify({ synthetic: data.claim.synthetic, calculation: data.calculation, runs: runs.map(run => ({ id: run._id, state: run.state, step: run.step, attempt: run.attempt, providerTurns: run.providerTurns, model: run.providerModel, inputTokens: run.inputTokens, outputTokens: run.outputTokens, lastError: run.lastError, tools: run.toolOutcomes.map(outcome => ({ tool: outcome.tool, status: outcome.status })) })), tasks: tasks.map(task => ({ id: task._id, type: task.type, question: task.question, amountAtRiskCents: task.amountAtRiskCents })), journalKinds: journals.map(journal => journal.kind) });
} });
export const acquire = internalMutation({ args: leaseArgs, returns: v.union(v.null(), schema.doc("agentRuns")), handler: async (ctx, args) => {
  const run = await ctx.db.get(args.runId);
  if (!run || !["QUEUED", "FAILED_RETRYABLE", "RUNNING"].includes(run.state) || (run.state === "RUNNING" && (run.leaseUntil ?? 0) > Date.now())) return null;
  const claim = await ctx.db.get(run.claimId);
  if (run.attempt >= MAX_ATTEMPTS || claim?.revision !== run.revision) {
    await ctx.db.patch(run._id, { state: "FAILED_TERMINAL", lastError: claim?.revision !== run.revision ? "STALE_CLAIM_REVISION" : "RETRY_BUDGET_EXHAUSTED", updatedAt: Date.now() });
    await audit(ctx, run, "INVESTIGATION_FAILED_TERMINAL"); return null;
  }
  await ctx.db.patch(run._id, { state: "RUNNING", attempt: run.attempt + 1, leaseToken: args.token, leaseUntil: Date.now() + 90_000, updatedAt: Date.now() });
  await audit(ctx, run, "INVESTIGATION_ATTEMPT_STARTED", { attempt: run.attempt + 1 });
  await ctx.scheduler.runAfter(90_001, internal.internal.agent.investigate, { runId: run._id });
  await evaluateRun(ctx, (await ctx.db.get(run._id))!);
  return ctx.db.get(run._id);
} });
export const saveResponse = internalMutation({ args: { ...leaseArgs, content: v.string(), model: v.string(), inputTokens: v.number(), outputTokens: v.number(), requestId: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const run = await leased(ctx, args.runId, args.token);
  if (run.pendingTools?.length) throw new Error("PENDING_TOOLS_NOT_EXECUTED");
  if ((run.providerTurns ?? 0) >= MAX_PROVIDER_TURNS) throw new Error("PROVIDER_TURN_BUDGET_EXHAUSTED");
  const raw: unknown = JSON.parse(args.content);
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_TOOL_STEPS + 1 || args.content.length > 25_000) throw new Error("INVALID_PROVIDER_RESPONSE");
  const content: AgentBlock[] = raw.map((block: unknown) => {
    if (!block || typeof block !== "object") throw new Error("INVALID_PROVIDER_RESPONSE");
    const value = block as Record<string, unknown>;
    if (value.type === "text" && typeof value.text === "string" && value.text.length <= 12_000) return { type: "text", text: value.text };
    if (value.type === "tool_use" && typeof value.id === "string" && value.id.length <= 150 && typeof value.name === "string" && value.name.length <= 100 && value.input && typeof value.input === "object" && !Array.isArray(value.input)) return { type: "tool_use", id: value.id, name: value.name, input: value.input as Record<string, string | number> };
    throw new Error("INVALID_PROVIDER_RESPONSE");
  });
  const calls = content.filter(block => block.type === "tool_use");
  if (calls.length + run.step > MAX_TOOL_STEPS || new Set(calls.map(call => call.id)).size !== calls.length) throw new Error("TOOL_STEP_BUDGET_OR_ID_INVALID");
  if (![args.inputTokens, args.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("INVALID_PROVIDER_USAGE");
  const messages = JSON.parse(run.messages!) as AgentMessage[]; messages.push({ role: "assistant", content });
  await ctx.db.patch(run._id, { messages: JSON.stringify(messages), pendingTools: calls.map(call => ({ id: call.id, name: call.name, input: JSON.stringify(call.input) })), pendingResults: [], providerTurns: (run.providerTurns ?? 0) + 1, providerModel: args.model, inputTokens: (run.inputTokens ?? 0) + args.inputTokens, outputTokens: (run.outputTokens ?? 0) + args.outputTokens, lastProviderRequestId: args.requestId, leaseUntil: Date.now() + 90_000, updatedAt: Date.now() });
  await audit(ctx, run, "CLAUDE_RESPONSE_RECEIVED", { model: args.model, inputTokens: args.inputTokens, outputTokens: args.outputTokens, toolCount: calls.length });
  await ctx.scheduler.runAfter(90_001, internal.internal.agent.investigate, { runId: run._id });
  return null;
} });
export const executeNext = internalMutation({ args: leaseArgs, returns: v.boolean(), handler: async (ctx, args) => {
  const run = await leased(ctx, args.runId, args.token), call = run.pendingTools?.[0]; if (!call) return false;
  if (run.step >= MAX_TOOL_STEPS) throw new Error("TOOL_STEP_BUDGET_EXHAUSTED");
  const outcome = await executeTool(ctx, run, call.name, call.input), remaining = run.pendingTools!.slice(1);
  const results = [...(run.pendingResults ?? []), { id: call.id, content: outcome.result, isError: outcome.status !== "OK" }];
  const messages = JSON.parse(run.messages!) as AgentMessage[];
  if (!remaining.length) messages.push({ role: "user", content: results.map(result => ({ type: "tool_result", tool_use_id: result.id, content: result.content, is_error: result.isError })) });
  await ctx.db.patch(run._id, { step: run.step + 1, pendingTools: remaining, pendingResults: remaining.length ? results : [], messages: JSON.stringify(messages), toolOutcomes: [...run.toolOutcomes, { tool: call.name, arguments: call.input, ...outcome, at: Date.now() }], updatedAt: Date.now() });
  await audit(ctx, run, "AGENT_TOOL_EXECUTED", { tool: call.name, status: outcome.status, step: run.step + 1, sourceIds: outcome.sourceIds.join(",") });
  return true;
} });
export const transition = internalMutation({ args: { ...leaseArgs, summary: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const run = await leased(ctx, args.runId, args.token); if (run.pendingTools?.length) throw new Error("PENDING_TOOLS_NOT_EXECUTED");
  if (!run.toolOutcomes.some(outcome => outcome.tool === "get_claim_snapshot" && outcome.status === "OK")) throw new Error("INVESTIGATION_REQUIRES_VERIFIED_SNAPSHOT");
  const data = await getClaimCalculation(ctx, run.claimId);
  const taskId = await ensureOpsTask(ctx, run), state = taskId ? "WAITING_HUMAN" as const : data.calculation.disputedCents ? "WAITING_EXTERNAL" as const : "SUCCEEDED" as const;
  await ctx.db.patch(run.claimId, { supportedCents: data.calculation.supportedCents, unverifiedCents: data.calculation.unverifiedCents, disputedCents: data.calculation.disputedCents, status: taskId ? "WAITING_OPERATIONS" : data.calculation.disputedCents ? "DISPUTE_PREPARED" : "INVESTIGATING", updatedAt: Date.now() });
  await ctx.db.patch(run._id, { state, finalSummary: hasInstructionText(args.summary) ? "Summary withheld: instruction-like text. See deterministic totals and validated tool trace." : args.summary.slice(0, 6000), leaseToken: undefined, leaseUntil: undefined, lastError: undefined, updatedAt: Date.now() });
  await audit(ctx, run, "INVESTIGATION_COMPLETED", { state, workItemId: taskId ?? "none" }); return null;
} });
export const fail = internalMutation({ args: { ...leaseArgs, code: v.string(), retryable: v.boolean() }, returns: v.null(), handler: async (ctx, args) => {
  const run = await ctx.db.get(args.runId); if (!run || run.state !== "RUNNING" || run.leaseToken !== args.token) return null;
  const retry = args.retryable && run.attempt < MAX_ATTEMPTS;
  await ctx.db.patch(run._id, { state: retry ? "FAILED_RETRYABLE" : "FAILED_TERMINAL", lastError: args.code.slice(0, 100), leaseToken: undefined, leaseUntil: undefined, updatedAt: Date.now() });
  await audit(ctx, run, retry ? "INVESTIGATION_RETRY_SCHEDULED" : "INVESTIGATION_FAILED_TERMINAL", { code: args.code.slice(0, 100), attempt: run.attempt });
  if (retry) await ctx.scheduler.runAfter(1000 * 2 ** run.attempt, internal.internal.agent.investigate, { runId: run._id });
  else { const claim = await ctx.db.get(run.claimId); if (claim?.revision === run.revision) await ctx.db.patch(run.claimId, { status: "ON_HOLD", updatedAt: Date.now() }); }
  return null;
} });

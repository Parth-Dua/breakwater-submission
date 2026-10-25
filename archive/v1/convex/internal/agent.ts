"use node";
import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { randomUUID } from "node:crypto";
import { agentTools, INVESTIGATION_SYSTEM } from "../../src/lib/agent-tools";
import { MAX_PROVIDER_TURNS, safeProviderError, type AgentMessage } from "../../src/lib/agent-schemas";
export const investigate = internalAction({ args: { runId: v.id("agentRuns") }, returns: v.null(), handler: async (ctx, args) => {
  const token = randomUUID(), lease = { ...args, token };
  let run = await ctx.runMutation(internal.internal.workflow.acquire, lease); if (!run) return null;
  try {
    if (!process.env.ANTHROPIC_API_KEY) { await ctx.runMutation(internal.internal.workflow.fail, { ...lease, code: "MISSING_ANTHROPIC_KEY", retryable: false }); return null; }
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 60_000 });
    while (run) {
      while (run.pendingTools?.length) {
        await ctx.runMutation(internal.internal.workflow.executeNext, lease);
        run = await ctx.runQuery(internal.internal.workflow.getRun, args);
        if (!run || run.state !== "RUNNING" || run.leaseToken !== token) return null;
      }
      const messages = JSON.parse(run.messages!) as AgentMessage[], last = messages[messages.length - 1];
      if (last.role === "assistant" && last.content.every(block => block.type === "text")) {
        await ctx.runMutation(internal.internal.workflow.transition, { ...lease, summary: last.content.filter(block => block.type === "text").map(block => block.text).join("\n") }); return null;
      }
      if ((run.providerTurns ?? 0) >= MAX_PROVIDER_TURNS) throw new Error("PROVIDER_TURN_BUDGET_EXHAUSTED");
      const response = await client.messages.create({ model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6", max_tokens: 1536, system: INVESTIGATION_SYSTEM, tools: agentTools, messages, tool_choice: (run.providerTurns ?? 0) === 0 ? { type: "tool", name: "get_claim_snapshot" } : { type: "auto" } });
      if (!["tool_use", "end_turn"].includes(response.stop_reason ?? "")) throw new Error("INCOMPLETE_PROVIDER_RESPONSE");
      await ctx.runMutation(internal.internal.workflow.saveResponse, { ...lease, content: JSON.stringify(response.content), model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, requestId: response._request_id ?? "unavailable" });
      run = await ctx.runQuery(internal.internal.workflow.getRun, args);
      if (!run || run.state !== "RUNNING" || run.leaseToken !== token) return null;
    }
  } catch (error) {
    const workflowCodes = ["PROVIDER_TURN_BUDGET_EXHAUSTED", "INCOMPLETE_PROVIDER_RESPONSE", "STALE_CLAIM_REVISION", "STALE_WORKFLOW_LEASE", "TOOL_STEP_BUDGET", "INVALID_PROVIDER", "INVESTIGATION_REQUIRES"];
    const message = error instanceof Error ? error.message : "";
    const permanent = workflowCodes.find(code => message.includes(code));
    await ctx.runMutation(internal.internal.workflow.fail, { ...lease, ...(permanent ? { code: permanent, retryable: false } : safeProviderError(error)) });
  }
  return null;
} });

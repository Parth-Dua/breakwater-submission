"use node";
import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { parseToolCall, safeProviderError } from "../../src/lib/agent-schemas";
import { agentTools } from "../../src/lib/agent-tools";
export const smoke = internalAction({ args: { claimCode: v.string() }, returns: v.object({ live: v.boolean(), code: v.string(), model: v.optional(v.string()), tool: v.optional(v.string()), inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()), summary: v.optional(v.string()) }), handler: async (ctx, args) => {
  if (!process.env.ANTHROPIC_API_KEY) return { live: false, code: "MISSING_ANTHROPIC_KEY" };
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 60_000 }), model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  try {
    const tools = agentTools.filter(tool => tool.name === "get_claim_snapshot");
    const initial = { role: "user" as const, content: "Read the synthetic claim snapshot with the tool. Reply with ONE sentence giving supported/unverified/disputed integer cents, preserving uncertainty. No posting or approval. No tables or headings." };
    const first = await client.messages.create({ model, max_tokens: 256, messages: [initial], tools, tool_choice: { type: "tool", name: "get_claim_snapshot" } });
    const call = first.content.find(block => block.type === "tool_use");
    if (!call || call.type !== "tool_use") return { live: false, code: "NO_STRUCTURED_TOOL_CALL" };
    parseToolCall(call.name, call.input);
    const snapshot: string = await ctx.runQuery(internal.internal.investigationReads.smokeSnapshot, args);
    const final = await client.messages.create({ model, max_tokens: 256, tools, tool_choice: { type: "none" }, messages: [initial, { role: "assistant", content: first.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: snapshot }] }] });
    const summary = final.content.filter(block => block.type === "text").map(block => block.text).join("\n");
    if (final.stop_reason !== "end_turn" || !summary.trim()) return { live:false, code:"INCOMPLETE_PROVIDER_RESPONSE" };
    return { live: true, code: "LIVE_TOOL_ROUND_TRIP_VERIFIED", model: final.model, tool: call.name, inputTokens: first.usage.input_tokens + final.usage.input_tokens, outputTokens: first.usage.output_tokens + final.usage.output_tokens, summary };
  } catch (error) {
    return { live: false, code: safeProviderError(error).code };
  }
} });

import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireReader, requireRole } from "./access";
import { currentScenario } from "./workspace";
import { startRun } from "./internal/workflow";
import { toolOutcome } from "./validators";
async function scopedClaim(ctx: QueryCtx, claimId: Id<"claims">) {
  const claim = await ctx.db.get(claimId), scenario = await currentScenario(ctx);
  if (!claim || claim.scenarioId !== scenario?._id) throw new Error("Claim outside current workspace");
  return claim;
}
export const start = mutation({ args: { claimId: v.id("claims") }, returns: v.id("agentRuns"), handler: async (ctx, args) => {
  const actor = await requireRole(ctx, ["operations_reviewer", "finance_controller", "demo_admin"]); await scopedClaim(ctx, args.claimId);
  const runId = await startRun(ctx, args.claimId), run = await ctx.db.get(runId);
  await ctx.db.insert("auditEvents", { scenarioId: run!.scenarioId, synthetic: true, actor: actor._id, eventType: "INVESTIGATION_REQUESTED", entityType: "agentRun", entityId: runId, correlationId: run!.correlationId, at: Date.now(), details: { claimId: args.claimId } });
  return runId;
} });
export const listForClaim = query({ args: { claimId: v.id("claims") }, returns: v.array(v.object({ id: v.id("agentRuns"), revision: v.number(), state: v.string(), step: v.number(), attempt: v.number(), correlationId: v.string(), lastError: v.optional(v.string()), finalSummary: v.optional(v.string()), providerModel: v.optional(v.string()), providerTurns: v.number(), inputTokens: v.number(), outputTokens: v.number(), toolOutcomes: v.array(toolOutcome), workItemId: v.optional(v.id("workItems")) })), handler: async (ctx, args) => {
  await requireReader(ctx); await scopedClaim(ctx, args.claimId);
  const runs = await ctx.db.query("agentRuns").withIndex("by_claim", q => q.eq("claimId", args.claimId)).collect(), tasks = await ctx.db.query("workItems").withIndex("by_claim", q => q.eq("claimId", args.claimId)).collect();
  return runs.sort((a, b) => b.revision - a.revision).slice(0, 5).map(run => ({ id: run._id, revision: run.revision, state: run.state, step: run.step, attempt: run.attempt, correlationId: run.correlationId, lastError: run.lastError, finalSummary: run.finalSummary, providerModel: run.providerModel, providerTurns: run.providerTurns ?? 0, inputTokens: run.inputTokens ?? 0, outputTokens: run.outputTokens ?? 0, toolOutcomes: run.toolOutcomes, workItemId: tasks.find(task => task.correlationId === run.correlationId && task.type === "OPS_FACT")?._id }));
} });

import type { QueryCtx } from "./_generated/server";
import { requireReader } from "./access";
import { DEFAULT_SCENARIO } from "../src/domain/fixtures";
export async function currentScenario(ctx: QueryCtx) {
  const actor = await requireReader(ctx);
  if (actor.scenarioId) { const scenario = await ctx.db.get(actor.scenarioId); if (!scenario || scenario.status !== "ACTIVE") throw new Error("Workspace unavailable"); return scenario; }
  return ctx.db.query("scenarioRuns").withIndex("by_code", q => q.eq("scenarioCode", DEFAULT_SCENARIO)).unique();
}

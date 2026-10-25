import type { QueryCtx } from "../_generated/server";

/**
 * Company (sim) time for a namespace (REQ-SIM-01). Business timestamps come from here, never Date.now().
 * Namespaces without a clock (tests, sessions before import) fall back to wall time.
 */
export async function getSimNow(ctx: QueryCtx, ns: string): Promise<number> {
  const clock = await ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", ns)).first();
  return clock?.simNow ?? Date.now();
}

export async function getClock(ctx: QueryCtx, ns: string) {
  return ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", ns)).first();
}

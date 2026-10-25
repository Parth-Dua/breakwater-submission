import { query } from "./_generated/server";
import { v } from "convex/values";

export const status = query({
  args: {},
  returns: v.object({ service: v.literal("breakwater"), status: v.literal("ok"), synthetic: v.boolean() }),
  handler: () => ({ service: "breakwater", status: "ok", synthetic: true } as const),
});

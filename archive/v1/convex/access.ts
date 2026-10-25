import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export async function requireReader(ctx: QueryCtx) {
  const userId=await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Authentication required");
  const user=await ctx.db.get(userId);
  if (!user?.active) throw new ConvexError("An active workspace identity is required");
  return user;
}
export async function requireRole(ctx: QueryCtx, roles: ("operations_reviewer"|"finance_controller"|"auditor"|"demo_admin")[]) {
  const user=await requireReader(ctx);
  if(!roles.includes(user.role))throw new ConvexError("Permission denied for this role");
  return user;
}

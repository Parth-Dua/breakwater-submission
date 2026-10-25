import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { role } from "./validators";
import { v } from "convex/values";
export const current=query({args:{},returns:v.union(v.null(),v.object({id:v.id("users"),displayName:v.string(),role,active:v.boolean()})),handler:async ctx=>{
  const id=await getAuthUserId(ctx);if(!id)return null;
  const user=await ctx.db.get(id);return user?{id:user._id,displayName:user.displayName,role:user.role,active:user.active}:null;
}});

import { query } from "./_generated/server";
import { v } from "convex/values";
import schema from "./schema";
import { requireReader } from "./access";
import { currentScenario } from "./workspace";

export const getTimeline = query({args:{voyageCode:v.string()},returns:v.union(v.null(),v.object({voyage:schema.doc("voyages"),aisPoints:v.array(schema.doc("aisPoints")),portEvents:v.array(schema.doc("portEvents"))})),handler:async(ctx,args)=>{
  await requireReader(ctx);
  const scenario = await currentScenario(ctx);
  if (!scenario) return null;
  const voyage = await ctx.db.query("voyages").withIndex("by_code",q=>q.eq("voyageCode",args.voyageCode)).filter(q=>q.eq(q.field("scenarioId"),scenario._id)).unique();
  if (!voyage) return null;
  const aisPoints = await ctx.db.query("aisPoints").withIndex("by_voyage_at",q=>q.eq("voyageId",voyage._id)).collect();
  const portEvents = await ctx.db.query("portEvents").withIndex("by_voyage_start",q=>q.eq("voyageId",voyage._id)).collect();
  return {voyage,aisPoints,portEvents};
} });

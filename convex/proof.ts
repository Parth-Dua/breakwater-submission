import {v} from "convex/values";
import {query} from "./_generated/server";
import {scoreMetrics,type ScoreRow} from "../src/domain/score";
export const overview=query({args:{},returns:v.any(),handler:async ctx=>{
 const latest=await ctx.db.query("scoreRuns").withIndex("by_ran",q=>q.eq("ns","score")).order("desc").first();
 return{score:latest?{ranAt:latest.ranAt,model:latest.model,voyages:latest.voyages,metrics:{...scoreMetrics(latest.perVoyage as ScoreRow[]),...((latest.metrics as {wallMs?:number}).wallMs!==undefined?{wallMs:(latest.metrics as {wallMs:number}).wallMs}:{}),status:(latest.metrics as {status?:string}).status??"COMPLETE"},rows:latest.perVoyage as ScoreRow[]}:null};
}});

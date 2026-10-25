import { v } from "convex/values";
import { action, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { whyData, evidenceViews, type EvidenceView } from "./room";
import { chainHash, canonicalJson, GENESIS_HASH } from "../src/domain/canonical";
import type { EvidenceRef } from "../src/domain/laytime";
import type { QueryCtx } from "./_generated/server";

const args={entityId:v.string(),field:v.string()};
async function data(ctx:QueryCtx,entityId:string,field:string){
  if(!["BILLED","PAYABLE","RECOVERABLE","NET","TIME_BAR"].includes(field))throw Error("Unknown case total");
  const source=await whyData(ctx,entityId,field),provenance="provenance" in source&&source.provenance?source.provenance:{entity:{type:"CASE_TOTAL",id:entityId,field},citations:[] as EvidenceRef[],facts:[]};
  const version=parseInt(chainHash(GENESIS_HASH,{provenance,text:source.text,amount:"amount" in source?source.amount:null}).slice(0,12),16);
  return {source,provenance,version};
}
export const graph=internalQuery({args,returns:v.any(),handler:async(ctx,{entityId,field})=>{
  const {source,provenance,version}=await data(ctx,entityId,field),cached=(await ctx.db.query("explanations").withIndex("by_entity_field",q=>q.eq("ns","demo").eq("entityId",entityId).eq("field",field)).collect()).find(row=>row.entityVersion===version);
  return {version,provenance,amount:"amount" in source?source.amount:null,fallback:source.text,cached:cached?{text:cached.text,citations:await evidenceViews(ctx,cached.citations)}:null};
}});
export const save=internalMutation({args:{...args,version:v.number(),text:v.string(),citations:v.any(),model:v.string(),usage:v.optional(v.any())},returns:v.null(),handler:async(ctx,{entityId,field,version,text,citations,model,usage})=>{
  const current=await data(ctx,entityId,field);if(current.version!==version)return null;
  const allowed=new Set(current.provenance.citations.map(canonicalJson));
  if(!Array.isArray(citations)||!citations.every(ref=>allowed.has(canonicalJson(ref))))throw Error("Explanation citation outside provenance");
  const prior=await ctx.db.query("explanations").withIndex("by_entity_field",q=>q.eq("ns","demo").eq("entityId",entityId).eq("field",field)).collect();
  if(!prior.some(row=>row.entityVersion===version))await ctx.db.insert("explanations",{ns:"demo",origin:"AGENT",entityId,field,entityVersion:version,text,citations,model,...(usage?{usage}:{})});return null;
}});
export const why=action({args:{entityType:v.literal("CASE_TOTAL"),...args},returns:v.any(),handler:async(ctx,{entityId,field}):Promise<{text:string;citations:EvidenceView[]}>=>ctx.runAction(internal.node.explain.phrase,{entityId,field})});
export const evidence=internalQuery({args,returns:v.any(),handler:async(ctx,{entityId,field})=>(await ctx.db.query("explanations").withIndex("by_entity_field",q=>q.eq("ns","demo").eq("entityId",entityId).eq("field",field)).collect()).map(row=>({version:row.entityVersion,text:row.text,citations:row.citations,model:row.model,usage:row.usage??null}))});

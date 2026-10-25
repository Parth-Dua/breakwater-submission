import { query } from "./_generated/server";
import { v } from "convex/values";
import schema from "./schema";
import { requireReader } from "./access";
import { currentScenario } from "./workspace";
import { getClaimCalculation } from "./financeCore";
import { financialIntervals } from "../src/domain/claim-timeline";

const summary = v.object({ claimId:v.id("claims"),claimCode:v.string(),voyageCode:v.string(),vesselName:v.string(),carrier:v.string(),claimedCents:v.number(),supportedCents:v.number(),unverifiedCents:v.number(),disputedCents:v.number(),status:v.string(),updatedAt:v.number(),heldOut:v.boolean(),synthetic:v.literal(true) });
export const list = query({ args:{search:v.optional(v.string())},returns:v.array(summary),handler:async(ctx,args)=>{
  await requireReader(ctx);
  const scenario = await currentScenario(ctx);
  if (!scenario) return [];
  const claims = await ctx.db.query("claims").withIndex("by_scenario",q=>q.eq("scenarioId",scenario._id)).collect();
  const rows = await Promise.all(claims.map(async claim=>{
    const voyage = await ctx.db.get(claim.voyageId),invoice = await ctx.db.get(claim.invoiceId);
    const vessel = voyage ? await ctx.db.get(voyage.vesselId) : null;
    if (!voyage || !invoice || !vessel) throw new Error("Claim source integrity failure");
    return {claimId:claim._id,claimCode:claim.claimCode,voyageCode:voyage.voyageCode,vesselName:vessel.name,carrier:invoice.carrier,claimedCents:invoice.amountCents,supportedCents:claim.supportedCents,unverifiedCents:claim.unverifiedCents,disputedCents:claim.disputedCents,status:claim.status,updatedAt:claim.updatedAt,heldOut:voyage.heldOut,synthetic:true as const};
  }));
  const search = args.search?.trim().toLowerCase();
  return rows.filter(row=>!search || [row.claimCode,row.vesselName,row.voyageCode,row.carrier].some(value=>value.toLowerCase().includes(search))).sort((a,b)=>(b.unverifiedCents+b.disputedCents)-(a.unverifiedCents+a.disputedCents) || a.claimCode.localeCompare(b.claimCode));
} });

export const getDetail = query({args:{code:v.string()},returns:v.union(v.null(),v.object({claim:schema.doc("claims"),invoice:schema.doc("invoices"),voyage:schema.doc("voyages"),vessel:schema.doc("vessels"),charter:schema.doc("charters"),evidence:v.array(schema.doc("evidence")),conflicts:v.array(v.object({startAt:v.number(),endAt:v.number(),evidenceIds:v.array(v.string())})),calculation:v.object({claimedCents:v.number(),supportedCents:v.number(),unverifiedCents:v.number(),disputedCents:v.number(),supportedMinutes:v.number(),disputedMinutes:v.number(),unverifiedMinutes:v.number()}),intervals:v.array(v.object({startAt:v.number(),endAt:v.number(),treatment:v.union(v.literal("SUPPORTED"),v.literal("DISPUTED"),v.literal("UNVERIFIED")),cause:v.string(),evidenceIds:v.array(v.string())}))})),handler:async(ctx,args)=>{
  await requireReader(ctx);
  const scenario = await currentScenario(ctx);
  if (!scenario) return null;
  const claim = await ctx.db.query("claims").withIndex("by_code",q=>q.eq("claimCode",args.code)).filter(q=>q.eq(q.field("scenarioId"),scenario._id)).unique();
  if (!claim) return null;
  const invoice = await ctx.db.get(claim.invoiceId),voyage = await ctx.db.get(claim.voyageId);
  const vessel = voyage ? await ctx.db.get(voyage.vesselId) : null,charter = voyage ? await ctx.db.get(voyage.charterId) : null;
  if (!invoice || !voyage || !vessel || !charter) throw new Error("Claim source integrity failure");
  const evidence = await Promise.all(claim.evidenceIds.map(id=>ctx.db.get(id)));
  if (evidence.some(source=>!source || source.voyageId !== voyage._id)) throw new Error("Claim evidence association failure");
  const computed = await getClaimCalculation(ctx,claim._id);
  return {claim,invoice,voyage,vessel,charter,conflicts:computed.conflicts,evidence:evidence.filter(source=>source!==null),calculation:computed.calculation,intervals:financialIntervals(voyage,computed.segments,{version:charter.version,...charter.terms})};
} });

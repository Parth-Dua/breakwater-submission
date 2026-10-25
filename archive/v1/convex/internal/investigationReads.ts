import { internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { getClaimCalculation } from "../financeCore";
import { financialIntervals } from "../../src/domain/claim-timeline";
import { DEFAULT_SCENARIO } from "../../src/domain/fixtures";
export async function claimSnapshot(ctx: QueryCtx, claimId: Id<"claims">) {
  const data = await getClaimCalculation(ctx, claimId);
  return { claimId, claimCode: data.claim.claimCode, revision: data.claim.revision, voyageCode: data.voyage.voyageCode, synthetic: true, invoiceCode: data.originalInvoice.invoiceCode, invoiceStatus: data.originalInvoice.status, ...data.calculation, conflicts:data.conflicts, intervals: financialIntervals(data.voyage, data.segments, { version: data.charter.version, ...data.charter.terms }), charter: { code: data.charter.charterCode, version: data.charter.version, clauseReference: data.charter.clauseReference }, authority: "READ_AND_PROPOSE_ONLY" };
}
export const smokeSnapshot = internalQuery({ args: { claimCode: v.string() }, returns: v.string(), handler: async (ctx, args) => {
  const scenario = await ctx.db.query("scenarioRuns").withIndex("by_code", q => q.eq("scenarioCode", DEFAULT_SCENARIO)).unique();
  if (!scenario) throw new Error("Synthetic scenario not seeded");
  const claim = await ctx.db.query("claims").withIndex("by_code", q => q.eq("claimCode", args.claimCode)).filter(q => q.eq(q.field("scenarioId"), scenario._id)).unique();
  if (!claim) throw new Error("Claim not found");
  return JSON.stringify(await claimSnapshot(ctx, claim._id));
} });

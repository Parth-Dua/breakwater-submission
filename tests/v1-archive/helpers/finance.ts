import { internal } from "../../convex/_generated/api";
import { testBackend } from "./convex";
export async function preparedFinance(){
  const t=testBackend();await t.mutation(internal.seed.ensure,{});
  const ids=await t.run(async ctx=>{
    const claim=(await ctx.db.query("claims").collect()).find(claim=>claim.claimCode==="CL-203")!;
    const original=await ctx.db.get(claim.invoiceId);
    const log=await ctx.db.query("evidence").withIndex("by_code",q=>q.eq("evidenceCode","OPS-V-203")).unique();
    const period=(await ctx.db.query("accountingPeriods").collect()).find(period=>period.status==="OPEN")!;
    await ctx.db.patch(claim._id,{status:"ACCEPTED",unverifiedCents:0,disputedCents:2_000_000,evidenceIds:[...claim.evidenceIds,log!._id],revision:2});
    const invoiceId=await ctx.db.insert("invoices",{scenarioId:claim.scenarioId,synthetic:true,invoiceCode:"INV-203-R1",voyageId:claim.voyageId,carrier:original!.carrier,claimedMinutes:1440,amountCents:1_000_000,status:"ACCEPTED",replacesInvoiceId:claim.invoiceId,receivedAt:Date.now()});
    return {claimId:claim._id,invoiceId,periodId:period._id};
  });
  return {t,ids};
}
export async function testIdentity(t:ReturnType<typeof testBackend>,role:"operations_reviewer"|"finance_controller"|"auditor"|"demo_admin",active=true){
  const userId=await t.run(ctx=>ctx.db.insert("users",{identity:`test:${role}`,role,active,displayName:`Test ${role}`}));
  return {userId,client:t.withIdentity({subject:userId,tokenIdentifier:`test:${role}`})};
}

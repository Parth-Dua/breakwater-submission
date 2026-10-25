import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { resolveSourceSegments } from "../src/domain/source-resolution";
import { reconcileClaim,type SourceEvidence } from "../src/domain/charters";
import { validateJournal } from "../src/domain/ledger";
import { assertCents } from "../src/domain/money";
import { intervalMinutes } from "../src/domain/intervals";

export async function getClaimCalculation(ctx:QueryCtx,claimId:Id<"claims">) {
  const claim=await ctx.db.get(claimId);if(!claim)throw new Error("Claim not found");
  const voyage=await ctx.db.get(claim.voyageId),originalInvoice=await ctx.db.get(claim.invoiceId);
  const charter=voyage?await ctx.db.get(voyage.charterId):null;
  if(!voyage||!originalInvoice||!charter||voyage.scenarioId!==claim.scenarioId||charter.scenarioId!==claim.scenarioId||originalInvoice.voyageId!==voyage._id)throw new Error("Claim source integrity failure");
  if(originalInvoice.claimedMinutes!==intervalMinutes(voyage))throw new Error("Invoice duration differs from claimed voyage interval");
  const records=await Promise.all(claim.evidenceIds.map(id=>ctx.db.get(id)));
  if(records.some(source=>!source||source.voyageId!==voyage._id||source.scenarioId!==claim.scenarioId))throw new Error("Invalid claim evidence association");
  const evidence:SourceEvidence[]=records.flatMap(source=>source && (source.type==="PORT_NOTICE"||source.type==="SIGNED_OPS_LOG") ? [{id:source._id,voyageId:source.voyageId,type:source.type,signed:source.signedStatus==="SYNTHETIC_SIGNED"&&source.withdrawnAt===undefined,cause:source.cause??"UNKNOWN",startAt:source.startAt,endAt:source.endAt}] : []);
  const {segments,conflicts}=resolveSourceSegments(voyage,evidence);
  const calculation=reconcileClaim({voyageId:voyage._id,interval:{startAt:voyage.startAt,endAt:voyage.endAt},claimedCents:originalInvoice.amountCents,expectedCharterVersion:charter.version,charter:{version:charter.version,...charter.terms},segments,evidence});
  return {claim,voyage,charter,originalInvoice,evidence,segments,conflicts,calculation};
}
export async function accrualBalance(ctx:QueryCtx,claimId:Id<"claims">) {
  const entries=await ctx.db.query("journalEntries").withIndex("by_claim",q=>q.eq("claimId",claimId)).collect();
  let balance=0n;
  for(const entry of entries){
    const lines=await ctx.db.query("journalLines").withIndex("by_entry",q=>q.eq("entryId",entry._id)).collect();validateJournal(lines);
    for(const line of lines)if(line.accountCode==="ACCRUED_LIABILITY")balance+=(line.side==="CREDIT"?1n:-1n)*BigInt(line.amountCents);
  }
  if(balance<0n||balance>BigInt(Number.MAX_SAFE_INTEGER))throw new Error("Invalid matched accrual balance");
  return Number(balance);
}
export async function loadPostingInputs(ctx:QueryCtx,ids:{claimId:Id<"claims">;invoiceId:Id<"invoices">;periodId:Id<"accountingPeriods">}) {
  const context=await getClaimCalculation(ctx,ids.claimId),invoice=await ctx.db.get(ids.invoiceId),period=await ctx.db.get(ids.periodId);
  const {claim,calculation}=context,now=Date.now();
  if(!["ACCEPTED","POSTING_PENDING","WAITING_CONTROLLER"].includes(claim.status))throw new Error("Claim not accepted for posting");
  if(!invoice||invoice.status!=="ACCEPTED"||invoice.voyageId!==claim.voyageId||invoice.scenarioId!==claim.scenarioId)throw new Error("Accepted invoice for the same voyage required");
  if(invoice._id!==claim.invoiceId&&invoice.replacesInvoiceId!==claim.invoiceId)throw new Error("Revised invoice must replace the claimed invoice");
  if(invoice.amountCents!==calculation.supportedCents||invoice.claimedMinutes!==calculation.supportedMinutes||calculation.unverifiedCents!==0||calculation.unverifiedMinutes!==0)throw new Error("Accepted invoice differs from supported evidence and charter");
  if(claim.supportedCents!==calculation.supportedCents||claim.unverifiedCents!==calculation.unverifiedCents||claim.disputedCents!==calculation.disputedCents)throw new Error("Claim revision is stale relative to evidence");
  if(!period||period.scenarioId!==claim.scenarioId||period.status!=="OPEN"||!Number.isSafeInteger(period.startAt)||!Number.isSafeInteger(period.endAt)||period.startAt>=period.endAt||now<period.startAt||now>=period.endAt)throw new Error("Posting to locked or incorrect period denied");
  const priorAP=await ctx.db.query("journalEntries").withIndex("by_claim",q=>q.eq("claimId",claim._id)).filter(q=>q.eq(q.field("kind"),"AP")).collect();if(priorAP.length)throw new Error("Previously posted claim requires explicit adjustment; ordinary AP cannot post again");
  const matchedAccrual=await accrualBalance(ctx,claim._id);
  const required=["ACCEPTED_INVOICE","VERIFIED_EVIDENCE","EFFECTIVE_CHARTER","OPEN_PERIOD"];
  async function limit(actionType:"POST_AP"|"CLEAR_ACCRUAL") {
    const delegation=await ctx.db.query("delegations").withIndex("by_action_status",q=>q.eq("actionType",actionType).eq("status","ACTIVE")).filter(q=>q.eq(q.field("scenarioId"),claim.scenarioId)).unique();
    if(delegation)assertCents(delegation.maxAmountCents);
    return delegation&&delegation.effectiveAt<=now&&required.every(condition=>delegation.conditions.includes(condition))&&delegation.conditions.every(condition=>required.includes(condition))?delegation.maxAmountCents:0;
  }
  return {...context,invoice,period,matchedAccrual,invoiceLimit:await limit("POST_AP"),accrualLimit:await limit("CLEAR_ACCRUAL")};
}

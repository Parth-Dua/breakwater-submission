import { mutation,query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import schema from "./schema";
import { requireReader,requireRole } from "./access";
import { acceptedInvoiceLines,validateJournal,sameJournalPlan } from "../src/domain/ledger";
import { accrualBalance } from "./financeCore";
import { loadPostingInputs } from "./financeCore";
import { currentScenario } from "./workspace";

export const getClaimLedger=query({args:{claimId:v.optional(v.id("claims"))},returns:v.object({entries:v.array(v.object({entry:schema.doc("journalEntries"),lines:v.array(schema.doc("journalLines"))})),periods:v.array(schema.doc("accountingPeriods")),proposals:v.array(schema.doc("financialProposals")),adjustments:v.array(schema.doc("adjustmentProposals")),invoices:v.array(schema.doc("invoices")),claimCodes:v.array(v.object({id:v.id("claims"),code:v.string()})),previews:v.array(v.object({proposalId:v.id("financialProposals"),lines:v.array(v.object({accountCode:v.string(),side:v.string(),amountCents:v.number()})),validation:v.string()})),totals:v.object({expenseCents:v.number(),accrualCents:v.number(),apCents:v.number()})}),handler:async(ctx,args)=>{
  await requireReader(ctx);
  const scenario=await currentScenario(ctx);if(!scenario)return {entries:[],periods:[],proposals:[],adjustments:[],invoices:[],claimCodes:[],previews:[],totals:{expenseCents:0,accrualCents:0,apCents:0}};
  if(args.claimId){const claim=await ctx.db.get(args.claimId);if(!claim||claim.scenarioId!==scenario._id)throw new Error("Claim outside authorized workspace");}
  const entries=(await ctx.db.query("journalEntries").withIndex("by_scenario",q=>q.eq("scenarioId",scenario._id)).collect()).filter(entry=>!args.claimId||entry.claimId===args.claimId);
  const periods=await ctx.db.query("accountingPeriods").withIndex("by_scenario",q=>q.eq("scenarioId",scenario._id)).collect();
  const proposals=(await ctx.db.query("financialProposals").withIndex("by_scenario",q=>q.eq("scenarioId",scenario._id)).collect()).filter(proposal=>!args.claimId||proposal.claimId===args.claimId);
  const invoices=(await ctx.db.query("invoices").withIndex("by_scenario",q=>q.eq("scenarioId",scenario._id)).collect()),claims=await ctx.db.query("claims").withIndex("by_scenario",q=>q.eq("scenarioId",scenario._id)).collect();
  const detailed=await Promise.all(entries.map(async entry=>({entry,lines:await ctx.db.query("journalLines").withIndex("by_entry",q=>q.eq("entryId",entry._id)).collect()}))),totals={expenseCents:0,accrualCents:0,apCents:0};
  for(const{lines}of detailed){validateJournal(lines);for(const line of lines){const key=line.accountCode==="VOYAGE_EXPENSE"?"expenseCents":line.accountCode==="ACCRUED_LIABILITY"?"accrualCents":"apCents";totals[key]+=(line.side===(key==="expenseCents"?"DEBIT":"CREDIT")?1:-1)*line.amountCents;}}
  const previews=await Promise.all(proposals.map(async proposal=>{const invoice=invoices.find(i=>i._id===proposal.invoiceId);let validation="BLOCKED";try{const context=await loadPostingInputs(ctx,proposal);if(proposal.proposedLines&&!sameJournalPlan(proposal.proposedLines,acceptedInvoiceLines(context.matchedAccrual,context.invoice.amountCents)))throw new Error("Stale journal plan");validation="SOURCE_AND_PERIOD_VALIDATED";}catch{/* Preserve blocked state without echoing input/errors. */}return{proposalId:proposal._id,lines:proposal.proposedLines??(invoice?acceptedInvoiceLines(await accrualBalance(ctx,proposal.claimId),invoice.amountCents):[]),validation:proposal.status==="POSTED"?"POSTED":validation};}));
  const adjustments=(await ctx.db.query("adjustmentProposals").withIndex("by_scenario",q=>q.eq("scenarioId",scenario._id)).collect()).filter(p=>!args.claimId||p.claimId===args.claimId);
  return {entries:detailed,periods,proposals,adjustments,invoices,claimCodes:claims.map(c=>({id:c._id,code:c.claimCode})),previews,totals};
}});
export const reviewProposal=mutation({args:{proposalId:v.id("financialProposals"),decision:v.union(v.literal("APPROVE"),v.literal("REJECT"))},returns:v.id("financialProposals"),handler:async(ctx,args)=>{
  const user=await requireRole(ctx,["finance_controller"]),proposal=await ctx.db.get(args.proposalId);
  if(user.automationOnly)throw new Error("Human Controller review required");
  if(!proposal)throw new Error("Proposal not found");
  const scenario=await currentScenario(ctx);
  if(proposal.scenarioId!==scenario?._id)throw new Error("Proposal outside authorized workspace");
  if((args.decision==="APPROVE"&&["APPROVED","POSTED"].includes(proposal.status))||(args.decision==="REJECT"&&proposal.status==="REJECTED"))return proposal._id;
  if(["REJECTED","POSTED"].includes(proposal.status))throw new Error("Proposal review is closed");
  const claim=await ctx.db.get(proposal.claimId);if(!claim||claim.scenarioId!==proposal.scenarioId)throw new Error("Claim source integrity failure");
  if(args.decision==="APPROVE"){const {invoice,matchedAccrual}=await loadPostingInputs(ctx,proposal);if(proposal.proposedLines&&!sameJournalPlan(proposal.proposedLines,acceptedInvoiceLines(matchedAccrual,invoice.amountCents)))throw new Error("Proposal lines differ from current validated accounting");if(proposal.claimRevision!==claim.revision)throw new Error("Stale proposal requires a new review");}
  const at=Date.now();
  await ctx.db.patch(proposal._id,args.decision==="APPROVE"?{status:"APPROVED",approvedBy:user._id,approvedAt:at}:{status:"REJECTED"});
  await ctx.db.insert("auditEvents",{scenarioId:proposal.scenarioId,synthetic:true,actor:`user:${user._id}`,actorRole:user.role,eventType:args.decision==="APPROVE"?"FINANCIAL_PROPOSAL_APPROVED":"FINANCIAL_PROPOSAL_REJECTED",entityType:"financialProposal",entityId:proposal._id,correlationId:`finance:${claim._id}:${claim.revision}`,at,details:{claimId:claim._id,invoiceId:proposal.invoiceId,beforeState:proposal.status,afterState:args.decision==="APPROVE"?"APPROVED":"REJECTED"}});
  const tasks=await ctx.db.query("workItems").withIndex("by_claim",q=>q.eq("claimId",claim._id)).filter(q=>q.eq(q.field("proposalId"),proposal._id)).collect();for(const task of tasks)await ctx.db.patch(task._id,{status:args.decision==="APPROVE"?"APPROVED":"REJECTED",updatedAt:at});
  if(args.decision==="APPROVE"){await ctx.db.patch(claim._id,{status:"POSTING_PENDING",updatedAt:at});await ctx.scheduler.runAfter(0,internal.internal.ledger.postAuthorized,{proposalId:proposal._id});}else await ctx.db.patch(claim._id,{status:"ON_HOLD",updatedAt:at});
  return proposal._id;
}});

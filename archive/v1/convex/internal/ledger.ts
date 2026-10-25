import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { loadPostingInputs } from "../financeCore";
import { acceptedInvoiceLines,checkPostingAuthority,sameJournalPlan } from "../../src/domain/ledger";

export const createProposal=internalMutation({args:{claimId:v.id("claims"),invoiceId:v.id("invoices"),periodId:v.id("accountingPeriods")},returns:v.id("financialProposals"),handler:async(ctx,args)=>{
  const context=await loadPostingInputs(ctx,args),{claim,invoice,matchedAccrual,invoiceLimit,accrualLimit}=context;
  const existing=await ctx.db.query("financialProposals").withIndex("by_claim",q=>q.eq("claimId",claim._id)).filter(q=>q.and(q.eq(q.field("invoiceId"),invoice._id),q.eq(q.field("claimRevision"),claim.revision),q.eq(q.field("periodId"),args.periodId))).unique();
  if(existing)return existing._id;
  const requiresApproval=invoice.amountCents>invoiceLimit||matchedAccrual>accrualLimit;
  const id=await ctx.db.insert("financialProposals",{scenarioId:claim.scenarioId,synthetic:true,...args,status:requiresApproval?"REQUIRES_APPROVAL":"DRAFT",proposedLines:acceptedInvoiceLines(matchedAccrual,invoice.amountCents),claimRevision:claim.revision,reason:requiresApproval?"Posting exceeds standing delegated authority":"Accepted invoice within standing delegated authority"});
  await ctx.db.insert("auditEvents",{scenarioId:claim.scenarioId,synthetic:true,actor:"agent:proposal",actorRole:"finance_agent",eventType:"FINANCIAL_PROPOSAL_CREATED",entityType:"financialProposal",entityId:id,correlationId:`finance:${claim._id}:${claim.revision}`,at:Date.now(),details:{claimId:claim._id,invoiceId:invoice._id,requiresApproval}});
  if(requiresApproval){await ctx.db.patch(claim._id,{status:"WAITING_CONTROLLER",updatedAt:Date.now()});await ctx.db.insert("workItems",{scenarioId:claim.scenarioId,synthetic:true,claimId:claim._id,type:"CONTROLLER_FINANCIAL",assignedRole:"finance_controller",status:"OPEN",question:"Review accepted invoice posting above standing delegation. Procedure approval does not grant financial authority.",evidenceIds:claim.evidenceIds,proposalId:id,correlationId:`finance:${claim._id}:${claim.revision}`,operationKey:`posting-review:${id}`,updatedAt:Date.now()});}else await ctx.scheduler.runAfter(0,internal.internal.ledger.postAuthorized,{proposalId:id});
  return id;
}});
export const postAuthorized=internalMutation({args:{proposalId:v.id("financialProposals")},returns:v.id("journalEntries"),handler:async(ctx,args)=>{
  const proposal=await ctx.db.get(args.proposalId);if(!proposal)throw new Error("Proposal not found");
  const key=`invoice:${proposal.scenarioId}:${proposal.claimId}:${proposal.invoiceId}`;
  const existing=await ctx.db.query("journalEntries").withIndex("by_idempotency",q=>q.eq("idempotencyKey",key)).unique();
  if(existing)return existing._id;
  if(proposal.status==="REJECTED"||proposal.status==="POSTED")throw new Error("Proposal is not executable");
  const context=await loadPostingInputs(ctx,proposal),{claim,invoice,period,matchedAccrual,invoiceLimit,accrualLimit}=context;
  if(proposal.claimRevision!==claim.revision)throw new Error("Proposal refers to a stale claim revision");
  const approver=proposal.approvedBy?await ctx.db.get(proposal.approvedBy):null;
  const controllerApproved=proposal.status==="APPROVED"&&!!proposal.approvedAt&&approver?.role==="finance_controller"&&approver.active;
  checkPostingAuthority({invoiceAccepted:true,evidenceVerified:true,periodOpen:true,invoiceCents:invoice.amountCents,accrualCents:matchedAccrual,invoiceLimit,accrualLimit,controllerApproved:!!controllerApproved});
  const lines=acceptedInvoiceLines(matchedAccrual,invoice.amountCents);if(proposal.proposedLines&&!sameJournalPlan(proposal.proposedLines,lines))throw new Error("Proposal lines differ from current validated accounting");
  const common={scenarioId:claim.scenarioId,synthetic:true as const},at=Date.now();
  const entryId=await ctx.db.insert("journalEntries",{...common,entryCode:`AP-${invoice.invoiceCode}`,claimId:claim._id,periodId:period._id,idempotencyKey:key,sourceIds:[...claim.evidenceIds,invoice._id,context.charter._id],status:"POSTED",postedAt:at,authority:controllerApproved?`controller:${approver!._id}`:"standing:POST_AP+CLEAR_ACCRUAL",kind:"AP"});
  const invoiceLines=matchedAccrual?lines.slice(2):lines;
  for(const line of invoiceLines)await ctx.db.insert("journalLines",{...common,entryId,...line});
  if(matchedAccrual){
    const reversalId=await ctx.db.insert("journalEntries",{...common,entryCode:`REVERSAL-${invoice.invoiceCode}`,claimId:claim._id,periodId:period._id,idempotencyKey:`${key}:accrual-reversal`,sourceIds:[...claim.evidenceIds,invoice._id,context.charter._id],status:"POSTED",postedAt:at,authority:controllerApproved?`controller:${approver!._id}`:"standing:CLEAR_ACCRUAL",kind:"ACCRUAL_REVERSAL"});
    for(const line of lines.slice(0,2))await ctx.db.insert("journalLines",{...common,entryId:reversalId,...line});
    await ctx.db.insert("auditEvents",{...common,actor:controllerApproved?`user:${approver!._id}`:"agent:delegated",actorRole:controllerApproved?"finance_controller":"finance_agent",eventType:"ACCRUAL_REVERSED",entityType:"journalEntry",entityId:reversalId,correlationId:`finance:${claim._id}:${claim.revision}`,at,details:{claimId:claim._id,invoiceId:invoice._id,proposalId:proposal._id,amountCents:matchedAccrual,currentPeriod:period.periodCode,apEntryId:entryId}});
  }
  await ctx.db.patch(proposal._id,{status:"POSTED"});
  await ctx.db.patch(claim._id,{status:"POSTED",updatedAt:at});
  await ctx.db.insert("auditEvents",{...common,actor:controllerApproved?`user:${approver!._id}`:"agent:delegated",actorRole:controllerApproved?"finance_controller":"finance_agent",eventType:"JOURNAL_POSTED",entityType:"journalEntry",entityId:entryId,correlationId:`finance:${claim._id}:${claim.revision}`,at,details:{claimId:claim._id,invoiceId:invoice._id,proposalId:proposal._id,amountCents:invoice.amountCents,accrualClearedCents:matchedAccrual,authority:controllerApproved?"CONTROLLER_APPROVAL":"STANDING_DELEGATION"}});
  return entryId;
}});

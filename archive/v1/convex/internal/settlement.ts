import { internalMutation,type MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { getClaimCalculation } from '../financeCore';
import { assertCents } from '../../src/domain/money';
export async function receiveRevision(ctx:MutationCtx,input:{claimId:Id<'claims'>;invoiceCode:string;amountCents:number;claimedMinutes:number;actor:string}){
 assertCents(input.amountCents);if(!Number.isSafeInteger(input.claimedMinutes)||input.claimedMinutes<=0||!/^INV-[A-Z0-9-]{1,60}$/.test(input.invoiceCode))throw new Error('Valid source invoice code and integer minutes required');
 const data=await getClaimCalculation(ctx,input.claimId),{claim,calculation,originalInvoice}=data;
 const existing=await ctx.db.query('invoices').withIndex('by_code',q=>q.eq('invoiceCode',input.invoiceCode)).filter(q=>q.eq(q.field('scenarioId'),claim.scenarioId)).unique();if(existing){if(existing.voyageId!==claim.voyageId||existing.amountCents!==input.amountCents||existing.claimedMinutes!==input.claimedMinutes||existing.replacesInvoiceId!==claim.invoiceId)throw new Error('Invoice code conflicts with existing source');return existing._id;}
 if(!['DISPUTE_PREPARED','AWAITING_VENDOR_REVISION','WAITING_CONTROLLER'].includes(claim.status))throw new Error('Claim must await a revised carrier invoice');
 const accepted=calculation.unverifiedCents===0&&calculation.unverifiedMinutes===0&&input.amountCents===calculation.supportedCents&&input.claimedMinutes===calculation.supportedMinutes&&input.amountCents>0;
 const invoiceId=await ctx.db.insert('invoices',{scenarioId:claim.scenarioId,synthetic:true,invoiceCode:input.invoiceCode,voyageId:claim.voyageId,carrier:originalInvoice.carrier,claimedMinutes:input.claimedMinutes,amountCents:input.amountCents,status:accepted?'ACCEPTED':'RECEIVED',replacesInvoiceId:claim.invoiceId,receivedAt:Date.now()});
 await ctx.db.insert('auditEvents',{scenarioId:claim.scenarioId,synthetic:true,actor:input.actor,eventType:accepted?'REVISED_INVOICE_ACCEPTED':'REVISED_INVOICE_REQUIRES_REVIEW',entityType:'invoice',entityId:invoiceId,correlationId:`invoice:${invoiceId}`,at:Date.now(),details:{claimId:claim._id,amountCents:input.amountCents,claimedMinutes:input.claimedMinutes,replacesInvoiceId:claim.invoiceId,accepted,sourceKind:'SYNTHETIC_CARRIER_REVISION'}});
 if(accepted){await ctx.db.patch(originalInvoice._id,{status:'SUPERSEDED'});await ctx.db.patch(claim._id,{status:'ACCEPTED',revision:claim.revision+1,updatedAt:Date.now()});await ctx.scheduler.runAfter(0,internal.internal.settlement.prepare,{claimId:claim._id,invoiceId});}
 else{await ctx.db.patch(claim._id,{status:'WAITING_CONTROLLER',revision:claim.revision+1,updatedAt:Date.now()});await ctx.db.insert('workItems',{scenarioId:claim.scenarioId,synthetic:true,claimId:claim._id,type:'CONTROLLER_FINANCIAL',assignedRole:'finance_controller',status:'OPEN',question:'Revised invoice differs from verified supported amount/minutes. Posting is blocked; request a corrected carrier source.',evidenceIds:claim.evidenceIds,correlationId:`invoice:${invoiceId}`,operationKey:`invoice-mismatch:${invoiceId}`,updatedAt:Date.now()});}
 return invoiceId;
}
export const prepare=internalMutation({args:{claimId:v.id('claims'),invoiceId:v.id('invoices')},returns:v.null(),handler:async(ctx,args)=>{
 const claim=await ctx.db.get(args.claimId),invoice=await ctx.db.get(args.invoiceId);if(!claim||!invoice||claim.status==='POSTED')return null;
 const periods=await ctx.db.query('accountingPeriods').withIndex('by_scenario',q=>q.eq('scenarioId',claim.scenarioId)).collect(),open=periods.filter(p=>p.status==='OPEN'&&p.startAt<=Date.now()&&p.endAt>Date.now());
 if(open.length!==1){await ctx.db.patch(claim._id,{status:'WAITING_CONTROLLER',updatedAt:Date.now()});await ctx.db.insert('auditEvents',{scenarioId:claim.scenarioId,synthetic:true,actor:'internal:settlement',eventType:'POSTING_PERIOD_BLOCKED',entityType:'claim',entityId:claim._id,correlationId:`invoice:${invoice._id}`,at:Date.now(),details:{invoiceId:invoice._id,backdated:false}});return null;}
 await ctx.scheduler.runAfter(0,internal.internal.ledger.createProposal,{...args,periodId:open[0]._id});return null;
}});

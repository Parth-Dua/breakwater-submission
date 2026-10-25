import { internalMutation, type MutationCtx, type QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { v } from 'convex/values';
import { candidateProvenance } from "../memories";
import { getClaimCalculation } from '../financeCore';
import { financialIntervals } from '../../src/domain/claim-timeline';
import { interpretProcedure, selectProcedure } from '../../src/domain/procedures';
import { hasPassingCoverage } from '../../src/domain/procedure-fixtures';
import { parseProcedure } from '../../src/lib/procedure-schema';
export async function eligibleProcedures(ctx:QueryCtx,run:Doc<'agentRuns'>) {
 const active=await ctx.db.query('approvedProcedures').withIndex('by_status',q=>q.eq('status','ACTIVE')).filter(q=>q.eq(q.field('scenarioId'),run.scenarioId)).collect(),valid:typeof active=[];
 for(const procedure of active){
  if(!procedure.candidateId||!procedure.sourceEpisodeId||procedure.scope.archiveAccess!=='SIGNED_OPS_LOG')continue;
  const candidate=await ctx.db.get(procedure.candidateId),episode=await ctx.db.get(procedure.sourceEpisodeId),controller=await ctx.db.get(procedure.approvedBy),session=episode?.sessionId?await ctx.db.get(episode.sessionId):null;
  const sourceActor=session?await ctx.db.get(session.actorId):null;
  if(!sourceActor?.active||sourceActor.automationOnly||sourceActor.role!=='operations_reviewer'||!controller?.active||controller.role!=='finance_controller'||controller.automationOnly||candidate?.status!=='APPROVED'||candidate.scenarioId!==run.scenarioId||candidate.sourceEpisodeId!==episode?._id||episode?.captureOrigin!=='APPLICATION_UI'||episode.kind!=='OBSERVED_SESSION'||!session||session.status!=='COMPLETED'||session.captureOrigin!=='APPLICATION_UI'||!hasPassingCoverage(candidate.testReport,candidate.revision)||JSON.stringify(candidate.scope)!==JSON.stringify(procedure.scope)||JSON.stringify(candidate.steps)!==JSON.stringify(procedure.steps))continue;
  try{await candidateProvenance(ctx,candidate);parseProcedure({dslVersion:1,scope:procedure.scope,steps:procedure.steps});valid.push(procedure);}catch{continue;}
 }
 return valid;
}
export async function authorizedArchiveProcedure(ctx:QueryCtx,run:Doc<'agentRuns'>,clauseFamily:string,unexplained:boolean){
 const selected=selectProcedure(await eligibleProcedures(ctx,run),{claimType:'DELAY',clauseFamily,unexplained:unexplained?[{startAt:0,endAt:60_000}]:[]});return selected.status==='MATCH'?selected.procedure:null;
}
export async function evaluateRun(ctx:MutationCtx,run:Doc<'agentRuns'>){
 if(run.state!=='RUNNING')throw new Error('ACTIVE_WORKFLOW_REQUIRED');const data=await getClaimCalculation(ctx,run.claimId);if(data.claim.scenarioId!==run.scenarioId||data.claim.revision!==run.revision)throw new Error('STALE_CLAIM_REVISION');
 const unexplained=financialIntervals(data.voyage,data.segments,{version:data.charter.version,...data.charter.terms}).filter(window=>window.treatment==='UNVERIFIED').map(({startAt,endAt})=>({startAt,endAt}));
 const selected=selectProcedure(await eligibleProcedures(ctx,run),{claimType:'DELAY',clauseFamily:data.charter.clauseFamily,unexplained});
 if(selected.status!=='MATCH')return selected.status;
 const procedure=selected.procedure,existing=await ctx.db.query('procedureExecutions').withIndex('by_claim',q=>q.eq('claimId',run.claimId)).filter(q=>q.eq(q.field('runId'),run._id)).collect();if(existing.length)return existing[0].result;
 const records=await ctx.db.query('evidence').withIndex('by_voyage_type',q=>q.eq('voyageId',data.voyage._id).eq('type','SIGNED_OPS_LOG')).collect();
 const result=interpretProcedure({dslVersion:1,scope:procedure.scope,steps:procedure.steps},{claimType:'DELAY',clauseFamily:data.charter.clauseFamily,voyageId:data.voyage._id,interval:data.voyage,unexplained,claimedCents:data.originalInvoice.amountCents,charter:{version:data.charter.version,...data.charter.terms},segments:data.segments,evidence:data.evidence,archive:records.filter(source=>source.scenarioId===run.scenarioId&&source.visibility==='OPS_ARCHIVE'&&source.withdrawnAt===undefined).map(source=>({id:source._id,voyageId:source.voyageId,type:'SIGNED_OPS_LOG',signed:source.signedStatus==='SYNTHETIC_SIGNED',cause:source.cause??'UNKNOWN',startAt:source.startAt,endAt:source.endAt,content:source.content}))});
 if(result.status==='APPLIED'&&result.calculation){const ids=records.filter(source=>result.evidenceIds.includes(source._id)).map(source=>source._id);if(ids.length!==result.evidenceIds.length)throw new Error('PROCEDURE_SOURCE_INTEGRITY');await ctx.db.patch(data.claim._id,{evidenceIds:[...new Set([...data.claim.evidenceIds,...ids])],supportedCents:result.calculation.supportedCents,unverifiedCents:result.calculation.unverifiedCents,disputedCents:result.calculation.disputedCents,updatedAt:Date.now()});}
 await ctx.db.insert('procedureExecutions',{scenarioId:run.scenarioId,synthetic:true,procedureId:procedure._id,claimId:run.claimId,runId:run._id,result:result.status,toolOutcomes:result.trace.map(step=>({tool:step.op,arguments:JSON.stringify(procedure.steps.find(item=>item.op===step.op)),result:step.outcome,status:step.outcome==='OK'?'OK':'NEEDS_REVIEW',sourceIds:step.sourceIds,at:Date.now()})),at:Date.now()});
 await ctx.db.insert('auditEvents',{scenarioId:run.scenarioId,synthetic:true,actor:'internal:procedure-interpreter',eventType:'PROCEDURE_EVALUATED',entityType:'claim',entityId:run.claimId,correlationId:run.correlationId,at:Date.now(),details:{procedureId:procedure._id,procedureCode:procedure.procedureCode,version:procedure.version,sourceEpisodeId:procedure.sourceEpisodeId??null,approvalActor:procedure.approvedBy,result:result.status,evidenceIds:result.evidenceIds,financialAuthorityGranted:false}});return result.status;
}
export const evaluate=internalMutation({args:{runId:v.id('agentRuns'),token:v.string()},returns:v.string(),handler:async(ctx,args)=>{const run=await ctx.db.get(args.runId);if(!run||run.state!=='RUNNING'||run.leaseToken!==args.token||(run.leaseUntil??0)<Date.now())throw new Error('STALE_WORKFLOW_LEASE');return evaluateRun(ctx,run);}});

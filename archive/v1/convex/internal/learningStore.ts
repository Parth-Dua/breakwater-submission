import { internalMutation, internalQuery, type MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { v } from 'convex/values';
import { parseReconstruction } from '../../src/lib/episode-schema';
import { hasInstructionText } from '../../src/lib/agent-schemas';
import { hasPassingCoverage, testProcedure } from '../../src/domain/procedure-fixtures';
export async function enqueueLearning(ctx:MutationCtx,sessionId:Id<'workSessions'>) {
 const session=await ctx.db.get(sessionId);if(!session||session.status!=='COMPLETED'||session.captureOrigin!=='APPLICATION_UI')return null;
 const actor=await ctx.db.get(session.actorId);if(!actor?.active||actor.automationOnly)return null;
 const existing=await ctx.db.query('learningJobs').withIndex('by_session',q=>q.eq('sessionId',sessionId)).unique();if(existing)return existing._id;
 const id=await ctx.db.insert('learningJobs',{scenarioId:session.scenarioId,synthetic:true,sessionId,status:'QUEUED',attempt:0,updatedAt:Date.now()});
 await ctx.scheduler.runAfter(0,internal.internal.learning.reconstructEpisode,{jobId:id});return id;
}
export const enqueue=internalMutation({args:{sessionId:v.id('workSessions')},returns:v.union(v.null(),v.id('learningJobs')),handler:(ctx,args)=>enqueueLearning(ctx,args.sessionId)});
export const acquire=internalMutation({args:{jobId:v.id('learningJobs')},returns:v.union(v.null(),v.string()),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(!job||job.status==='SUCCEEDED'||job.status==='FAILED_TERMINAL'||job.status==='RUNNING'&&(job.leaseUntil??0)>Date.now())return null;
 if(job.attempt>=3){await ctx.db.patch(job._id,{status:'FAILED_TERMINAL',error:'LEARNING_ATTEMPTS_EXHAUSTED',updatedAt:Date.now()});return null;}
 const token=crypto.randomUUID();await ctx.db.patch(job._id,{status:'RUNNING',attempt:job.attempt+1,leaseToken:token,leaseUntil:Date.now()+90_000,updatedAt:Date.now()});
 await ctx.scheduler.runAfter(95_000,internal.internal.learningStore.watchdog,{jobId:job._id,token});return token;
}});
export const packet=internalQuery({args:{jobId:v.id('learningJobs'),token:v.string()},returns:v.string(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(!job||job.status!=='RUNNING'||job.leaseToken!==args.token||(job.leaseUntil??0)<Date.now())throw new Error('STALE_LEARNING_LEASE');
 const session=await ctx.db.get(job.sessionId),actor=session?await ctx.db.get(session.actorId):null,work=session?await ctx.db.get(session.workItemId):null;
 if(!session||session.status!=='COMPLETED'||session.captureOrigin!=='APPLICATION_UI'||!actor?.active||actor.automationOnly||!work||work.scenarioId!==job.scenarioId)throw new Error('ACTUAL_COMPLETED_HUMAN_SESSION_REQUIRED');
 const events=await ctx.db.query('actionEvents').withIndex('by_session_sequence',q=>q.eq('sessionId',session._id)).collect();
 if(!events.length||events.length>120||events.some((event,index)=>event.sequence!==index||event.actorId!==actor._id||event.scenarioId!==job.scenarioId))throw new Error('INVALID_OR_EXCESSIVE_OBSERVATION_CONTEXT');
 const evidence=await Promise.all(work.evidenceIds.map(id=>ctx.db.get(id)));if(evidence.length>16)throw new Error('EXCESSIVE_SOURCE_CONTEXT');
 return JSON.stringify({synthetic:true,captureOrigin:session.captureOrigin,problem:work.question,workStatus:work.status,explicitFinding:work.status==='SUBMITTED'?work.finding??null:null,events:events.map(({_id,eventType,at,payload})=>({eventId:_id,eventType,at,payload})),evidence:evidence.filter(e=>e!==null).map(({_id,type,signedStatus,voyageId,startAt,endAt,cause,content})=>({id:_id,type,signedStatus,voyageId,startAt,endAt,cause: cause??'UNKNOWN',untrustedContent:content.slice(0,2000)}))});
}});
export const persist=internalMutation({args:{jobId:v.id('learningJobs'),token:v.string(),output:v.string(),model:v.string(),inputTokens:v.number(),outputTokens:v.number()},returns:v.union(v.null(),v.id('caseEpisodes')),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(!job||job.status!=='RUNNING'||job.leaseToken!==args.token||(job.leaseUntil??0)<Date.now())return null;
 const session=await ctx.db.get(job.sessionId),work=session?await ctx.db.get(session.workItemId):null,actor=session?await ctx.db.get(session.actorId):null;
 if(!session||session.status!=='COMPLETED'||session.captureOrigin!=='APPLICATION_UI'||!work||!actor?.active||actor.automationOnly)throw new Error('ACTUAL_COMPLETED_HUMAN_SESSION_REQUIRED');
 const existing=await ctx.db.query('caseEpisodes').withIndex('by_session',q=>q.eq('sessionId',session._id)).unique();if(existing){await ctx.db.patch(job._id,{status:'SUCCEEDED',episodeId:existing._id,updatedAt:Date.now()});return existing._id;}
 const events=await ctx.db.query('actionEvents').withIndex('by_session_sequence',q=>q.eq('sessionId',session._id)).collect(),output=parseReconstruction(JSON.parse(args.output),events.map(event=>event._id));
 const finding=work.status==='SUBMITTED'&&!work.finding?.unavailable?work.finding:null,sources=await Promise.all((finding?.evidenceIds??[]).map(id=>ctx.db.get(id)));
 const claimRecord=await ctx.db.get(work.claimId);
 const commercialContext=claimRecord?await ctx.db.query('evidence').withIndex('by_voyage_type',q=>q.eq('voyageId',claimRecord.voyageId).eq('type','COMMERCIAL_EXCEPTION')).filter(q=>q.eq(q.field('scenarioId'),job.scenarioId)).collect():[];
 const contextSources=[...await Promise.all(work.evidenceIds.map(id=>ctx.db.get(id))),...commercialContext];
 const exception=output.classifications.includes('COMMERCIAL_EXCEPTION')||contextSources.some(source=>source?.type==='COMMERCIAL_EXCEPTION')||events.some(event=>event.eventType==='EXCEPTION_AUTHORIZED');
 const episodeId=await ctx.db.insert('caseEpisodes',{scenarioId:job.scenarioId,synthetic:true,episodeCode:`EP-${session._id}`,kind:exception?'CASE_EXCEPTION':'OBSERVED_SESSION',claimId:work.claimId,sessionId:session._id,captureOrigin:'APPLICATION_UI',contextEvidenceIds:commercialContext.map(source=>source._id),observedSteps:events.map(event=>({eventId:event._id,description:`${event.eventType} · ${new Date(event.at).toISOString()}`})),explicitFindings:finding?[JSON.stringify(finding)]:[],inferenceNotes:output.inferredRationale.map(note=>`Inference: ${note}`),summary:output.summary,ambiguities:output.ambiguities,classifications:[...new Set([...output.classifications,...(commercialContext.length?['COMMERCIAL_EXCEPTION']:[])])],evidenceIds:finding?.evidenceIds??[],reconstructedAt:Date.now()});
 let candidateId:Id<'procedureCandidates'>|undefined;
 const required=['ARCHIVE_SEARCHED','EVIDENCE_OPENED','EVIDENCE_COMPARED','EVIDENCE_LINKED','FINDING_SUBMITTED'];
 const claim=await ctx.db.get(work.claimId),completeIntent=required.every(type=>events.some(event=>event.eventType===type));
 const safeSources=!!finding&&sources.length>0&&sources.every(source=>source?.scenarioId===job.scenarioId&&source.voyageId===claim?.voyageId&&source.type==='SIGNED_OPS_LOG'&&source.signedStatus==='SYNTHETIC_SIGNED'&&!hasInstructionText(source.content));
 if(!exception&&!output.classifications.includes('GOVERNANCE_CHANGE')&&output.classifications.includes('INVESTIGATION_PROCEDURE')&&output.proposal&&completeIntent&&safeSources){
  const scenario=await ctx.db.get(job.scenarioId);if(!scenario)throw new Error('Scenario unavailable');const report=testProcedure(output.proposal,1),ready=hasPassingCoverage(report,1);
  const code=`P-${String(scenario.nextProcedureNumber).padStart(3,'0')}`;await ctx.db.patch(scenario._id,{nextProcedureNumber:scenario.nextProcedureNumber+1});
  candidateId=await ctx.db.insert('procedureCandidates',{scenarioId:job.scenarioId,synthetic:true,candidateCode:code,sourceEpisodeId:episodeId,...output.proposal,testReport:report,status:ready?'READY_FOR_REVIEW':'REJECTED',revision:1,summary:output.summary});
  if(ready)await ctx.db.insert('workItems',{scenarioId:job.scenarioId,synthetic:true,claimId:work.claimId,type:'CONTROLLER_PROCEDURE',assignedRole:'finance_controller',status:'OPEN',question:`Review ${code}: signed Operations evidence investigation. Grants scoped archive access only; financial delegation is unchanged.`,candidateId,evidenceIds:finding?.evidenceIds??[],correlationId:`learning:${session._id}`,operationKey:`procedure-review:${candidateId}:1`,updatedAt:Date.now()});
 }
 await ctx.db.insert('auditEvents',{scenarioId:job.scenarioId,synthetic:true,actor:'internal:learning',eventType:candidateId?'PROCEDURE_CANDIDATE_TESTED':'EPISODE_RECONSTRUCTED',entityType:'episode',entityId:episodeId,correlationId:`learning:${session._id}`,at:Date.now(),details:{sessionId:session._id,candidateId:candidateId??null,executable:false,model:args.model}});
 await ctx.db.patch(job._id,{status:'SUCCEEDED',episodeId,candidateId,model:args.model,inputTokens:args.inputTokens,outputTokens:args.outputTokens,leaseToken:undefined,leaseUntil:undefined,updatedAt:Date.now()});return episodeId;
}});
export const fail=internalMutation({args:{jobId:v.id('learningJobs'),token:v.string(),code:v.string(),retryable:v.boolean()},returns:v.null(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(!job||job.status!=='RUNNING'||job.leaseToken!==args.token)return null;
 const retry=args.retryable&&job.attempt<3;await ctx.db.patch(job._id,{status:retry?'FAILED_RETRYABLE':'FAILED_TERMINAL',error:args.code,leaseToken:undefined,leaseUntil:undefined,updatedAt:Date.now()});if(retry)await ctx.scheduler.runAfter(2**job.attempt*1000,internal.internal.learning.reconstructEpisode,{jobId:job._id});return null;
}});
export const watchdog=internalMutation({args:{jobId:v.id('learningJobs'),token:v.string()},returns:v.null(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(job?.status==='RUNNING'&&job.leaseToken===args.token&&(job.leaseUntil??0)<=Date.now())await ctx.scheduler.runAfter(0,internal.internal.learning.reconstructEpisode,{jobId:job._id});return null;
}});
export const inspect=internalQuery({args:{workItemId:v.id('workItems')},returns:v.string(),handler:async(ctx,args)=>{
 const work=await ctx.db.get(args.workItemId);if(!work)throw new Error('Work item unavailable');const sessions=await ctx.db.query('workSessions').withIndex('by_work_item',q=>q.eq('workItemId',work._id)).collect();
 const records=await Promise.all(sessions.map(async session=>{const events=await ctx.db.query('actionEvents').withIndex('by_session_sequence',q=>q.eq('sessionId',session._id)).collect(),job=await ctx.db.query('learningJobs').withIndex('by_session',q=>q.eq('sessionId',session._id)).unique();const episode=job?.episodeId?await ctx.db.get(job.episodeId):null,candidate=job?.candidateId?await ctx.db.get(job.candidateId):null;return{sessionId:session._id,status:session.status,captureOrigin:session.captureOrigin,actualEventTypes:events.map(event=>event.eventType),job,episode,candidate};}));return JSON.stringify({synthetic:true,workStatus:work.status,records});
}});
export const acceptance=internalQuery({args:{scenarioCode:v.string()},returns:v.string(),handler:async(ctx,args)=>{
 const scenario=await ctx.db.query('scenarioRuns').withIndex('by_code',q=>q.eq('scenarioCode',args.scenarioCode)).unique();if(!scenario)return JSON.stringify({status:'BLOCKED',code:'SCENARIO_NOT_FOUND'});
 const jobs=await ctx.db.query('learningJobs').withIndex('by_scenario',q=>q.eq('scenarioId',scenario._id)).collect();
 for(const job of jobs.filter(job=>job.status==='SUCCEEDED'&&job.episodeId&&job.candidateId).sort((a,b)=>b.updatedAt-a.updatedAt)){
  const episode=await ctx.db.get(job.episodeId!),candidate=await ctx.db.get(job.candidateId!),session=await ctx.db.get(job.sessionId),actor=session?await ctx.db.get(session.actorId):null;
  if(!episode||!candidate||episode.captureOrigin!=='APPLICATION_UI'||episode.kind!=='OBSERVED_SESSION'||!session||session.status!=='COMPLETED'||session.captureOrigin!=='APPLICATION_UI'||actor?.automationOnly||!actor?.active||!hasPassingCoverage(candidate.testReport,candidate.revision)||!job.model?.startsWith('claude-'))continue;
  const active=await ctx.db.query('approvedProcedures').withIndex('by_scenario',q=>q.eq('scenarioId',scenario._id)).filter(q=>q.eq(q.field('candidateId'),candidate._id)).collect();
  const validActivations=await Promise.all(active.map(async procedure=>{const controller=await ctx.db.get(procedure.approvedBy);return candidate.status==='APPROVED'&&controller?.role==='finance_controller'&&controller.active&&!controller.automationOnly;}));
  return JSON.stringify({status:validActivations.some(valid=>!valid)?'FAIL':'PASS',code:'ACTUAL_HUMAN_TO_LIVE_CLAUDE_CANDIDATE',captureOrigin:session.captureOrigin,sessionId:session._id,episodeId:episode._id,candidateId:candidate._id,candidateCode:candidate.candidateCode,candidateStatus:candidate.status,model:job.model,inputTokens:job.inputTokens,outputTokens:job.outputTokens,observedStepCount:episode.observedSteps.length,inferredStepCount:episode.inferenceNotes.length,explicitFindingCount:episode.explicitFindings.length,testCount:candidate.testReport!.results.length,activeVersions:active.filter(p=>p.status==='ACTIVE').length});
 }
 return JSON.stringify({status:'BLOCKED',code:'GENUINE_COMPLETED_OPERATIONS_SESSION_REQUIRED',learningStates:jobs.map(job=>({status:job.status,error:job.error??null}))});
}});
export const automatedPacket=internalQuery({args:{scenarioCode:v.string()},returns:v.string(),handler:async(ctx,args)=>{
 if(!/^breakwater-demo-ui[a-z0-9]+$/.test(args.scenarioCode))throw new Error('ISOLATED_AUTOMATION_NAMESPACE_REQUIRED');
 const scenario=await ctx.db.query('scenarioRuns').withIndex('by_code',q=>q.eq('scenarioCode',args.scenarioCode)).unique();if(!scenario)throw new Error('AUTOMATION_SCENARIO_REQUIRED');
 const sessions=await ctx.db.query('workSessions').withIndex('by_scenario',q=>q.eq('scenarioId',scenario._id)).collect(),session=sessions.find(session=>session.captureOrigin==='AUTOMATED_TEST'&&session.status==='COMPLETED');
 const actor=session?await ctx.db.get(session.actorId):null,work=session?await ctx.db.get(session.workItemId):null;if(!session||!actor?.automationOnly||!work||work.status!=='SUBMITTED')throw new Error('COMPLETED_AUTOMATION_REQUIRED');
 const events=await ctx.db.query('actionEvents').withIndex('by_session_sequence',q=>q.eq('sessionId',session._id)).collect();if(events.length>120)throw new Error('EXCESSIVE_CONTEXT');
 const sources=await Promise.all(work.evidenceIds.map(id=>ctx.db.get(id)));
 return JSON.stringify({synthetic:true,captureOrigin:'AUTOMATED_TEST',humanProof:false,problem:work.question,workStatus:work.status,explicitFinding:work.finding,events:events.map(({_id,eventType,at,payload})=>({eventId:_id,eventType,at,payload})),evidence:sources.filter(source=>source!==null).map(({_id,type,signedStatus,voyageId,startAt,endAt,cause,content})=>({id:_id,type,signedStatus,voyageId,startAt,endAt,cause:cause??'UNKNOWN',untrustedContent:content.slice(0,2000)}))});
}});

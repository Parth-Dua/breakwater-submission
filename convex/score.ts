import {v} from "convex/values";
import {internalMutation,internalQuery} from "./_generated/server";
import type {Id} from "./_generated/dataModel";
import {scheduleTask} from "./orchestrator";
import {latestStatement} from "./agent/state";
import {appendAudit} from "./lib/audit";
import {scoreMetrics,type ScoreRow} from "../src/domain/score";

export const start=internalMutation({args:{model:v.string()},returns:v.id("scoreRuns"),handler:async(ctx,{model})=>ctx.db.insert("scoreRuns",{ns:"score",origin:"AUTOMATED_TEST",ranAt:Date.now(),model,voyages:24,metrics:{status:"RUNNING"},perVoyage:[]})});
export const stage=internalMutation({args:{runId:v.id("scoreRuns"),source:v.any()},returns:v.string(),handler:async(ctx,{runId,source})=>{
 const run=await ctx.db.get(runId);if(!run||run.ns!=="score")throw Error("Unknown score run");
 const voyage=await ctx.db.query("voyages").withIndex("by_code",q=>q.eq("ns","score").eq("code",String(source.voyageCode))).unique();if(!voyage)throw Error("Score voyage not imported");
 const code=`${source.caseCode}-${String(runId).slice(-8)}`;let c=await ctx.db.query("cases").withIndex("by_code",q=>q.eq("ns","score").eq("code",code)).unique();
 if(!c){const id=await ctx.db.insert("cases",{ns:"score",origin:"AUTOMATED_TEST",code,voyageId:voyage._id,status:"WORKING",openedAt:Number(source.openedAt),statusLine:"Reviewing voyage",correlationId:`score:${runId}:${source.caseCode}`,updatedAt:Date.now()});c=(await ctx.db.get(id))!;}
 const points=await ctx.db.query("aisPoints").withIndex("by_vessel_at",q=>q.eq("ns","score").eq("vesselId",voyage.vesselId)).collect();
 if(!points.some(point=>point.voyageId===voyage._id))for(const point of source.ais)await ctx.db.insert("aisPoints",{ns:"score",origin:"WORLD_SCRIPT",voyageId:voyage._id,vesselId:voyage.vesselId,at:point.at,lon:point.lon,lat:point.lat,sogKn:point.sogKn,cogDeg:point.cogDeg});
 for(const docCode of source.documentCodes){const doc=await ctx.db.query("documents").withIndex("by_code",q=>q.eq("ns","score").eq("code",String(docCode))).unique();if(!doc)throw Error("Score PDF missing");await ctx.db.patch(doc._id,{voyageId:voyage._id});}
 for(const record of source.customs){const doc=await ctx.db.query("documents").withIndex("by_code",q=>q.eq("ns","score").eq("code",String(record.documentCode))).unique();if(!doc)throw Error("Score customs PDF missing");const prior=await ctx.db.query("customsRecords").withIndex("by_port_vessel",q=>q.eq("ns","score").eq("portId",voyage.portId).eq("vesselId",voyage.vesselId)).filter(q=>q.eq(q.field("documentId"),doc._id)).first();if(!prior)await ctx.db.insert("customsRecords",{ns:"score",origin:"WORLD_SCRIPT",portId:voyage.portId,vesselId:voyage.vesselId,documentId:doc._id,kind:record.kind,startAt:record.startAt,...(record.endAt!==undefined?{endAt:record.endAt}:{})});}
 return c.code;
}});
export const document=internalMutation({args:{caseCode:v.string(),documentCode:v.string()},returns:v.id("agentTasks"),handler:async(ctx,{caseCode,documentCode})=>{
 const c=await ctx.db.query("cases").withIndex("by_code",q=>q.eq("ns","score").eq("code",caseCode)).unique(),doc=await ctx.db.query("documents").withIndex("by_code",q=>q.eq("ns","score").eq("code",documentCode)).unique();if(!c||!doc)throw Error("Score source missing");
 const key=`score:${c._id}:${doc._id}`,existing=await ctx.db.query("agentTasks").withIndex("by_idempotency",q=>q.eq("ns","score").eq("idempotencyKey",key)).unique();if(existing)return existing._id;
 const clock=await ctx.db.query("simClock").withIndex("by_ns",q=>q.eq("ns","score")).first(),at=doc.receivedAt??0;
 if(clock)await ctx.db.patch(clock._id,{simNow:at,status:"IDLE"});else await ctx.db.insert("simClock",{ns:"score",origin:"SYSTEM",simNow:at,status:"IDLE",pacing:"1x"});
 const voyage=(await ctx.db.get(c.voyageId))!,vessel=(await ctx.db.get(voyage.vesselId))!;
 if(!await ctx.db.query("mailMessages").withIndex("by_ns",q=>q.eq("ns","score")).filter(q=>q.eq(q.field("documentId"),doc._id)).first())await ctx.db.insert("mailMessages",{ns:"score",origin:"WORLD_SCRIPT",documentId:doc._id,from:"score-source",subject:doc.title,receivedAt:at,vesselImo:vessel.imo,bodyText:"Attached source record."});
 const eventId=await ctx.db.insert("worldEvents",{ns:"score",origin:"WORLD_SCRIPT",scriptCode:caseCode,seq:1,type:"EMAIL",scheduledAt:at,releasedAt:at,payload:{documentCode,vesselCode:vessel.code,vesselImo:vessel.imo}});
 const taskId=await ctx.db.insert("agentTasks",{ns:"score",origin:"SYSTEM",kind:"DOCUMENT_RECEIVED",triggerEventId:eventId,caseId:c._id,state:"QUEUED",attempt:0,idempotencyKey:key,createdAt:Date.now(),updatedAt:Date.now()});await scheduleTask(ctx,taskId);return taskId;
}});
export const inspect=internalQuery({args:{caseCode:v.string()},returns:v.any(),handler:async(ctx,{caseCode})=>{
 const c=await ctx.db.query("cases").withIndex("by_code",q=>q.eq("ns","score").eq("code",caseCode)).unique();if(!c)throw Error("Unknown score case");const voyage=(await ctx.db.get(c.voyageId))!,vessel=(await ctx.db.get(voyage.vesselId))!;
 const tasks=await ctx.db.query("agentTasks").withIndex("by_case",q=>q.eq("ns","score").eq("caseId",c._id)).collect(),asks=await ctx.db.query("asks").withIndex("by_case",q=>q.eq("ns","score").eq("caseId",c._id)).collect(),statements=await latestStatement(ctx,"score",c._id,"PAYABLE"),reconciliation=c.reconciliation as {payableCents?:number;variances?:{kind:string;cents:number}[];acceptedFees?:{cents:number}[]}|undefined;
 const entries=(await ctx.db.query("journalEntries").withIndex("by_ns",q=>q.eq("ns","score")).collect()).filter(e=>e.caseId===c._id);let violations=0;
 for(const entry of entries){const lines=await ctx.db.query("journalLines").withIndex("by_entry",q=>q.eq("ns","score").eq("entryId",entry._id)).collect();if(lines.reduce((n,line)=>n+(line.side==="DEBIT"?line.cents:-line.cents),0)!==0)violations++;const period=await ctx.db.query("periods").withIndex("by_code",q=>q.eq("ns","score").eq("code",entry.periodCode)).unique();if(!period||entry.postedAt<period.startAt||entry.postedAt>period.endAt)violations++;if(entry.authority.kind==="APPROVAL"){const ask=await ctx.db.get(entry.authority.askId as Id<"asks">);if(!ask||ask.status!=="ANSWERED")violations++;}if(entries.some(other=>other._id!==entry._id&&other.idempotencyKey===entry.idempotencyKey))violations++;}
 if(entries.filter(entry=>entry.kind==="AP").length>1)violations+=entries.filter(entry=>entry.kind==="AP").length-1;
 const filings=await ctx.db.query("filings").withIndex("by_case",q=>q.eq("ns","score").eq("caseId",c._id)).collect();
 return{startedAt:c._creationTime,vessel:vessel.name,busy:tasks.some(task=>["QUEUED","RUNNING"].includes(task.state)),tasks:tasks.map(task=>({kind:task.kind,state:task.state,model:task.model??null,error:task.error??null,tokensIn:task.tokensIn??0,tokensOut:task.tokensOut??0})),openAsks:asks.filter(ask=>ask.status==="OPEN").map(ask=>({code:ask.code,kind:ask.kind,role:ask.role,subject:ask.subject})),actual:{payableCents:reconciliation?.payableCents??statements?.totals.totalCents??null,recoverableCents:filings.find(f=>f.kind==="RECOVERY_CLAIM")?.cents??c.recoverable?.totalCents??null,disputeLines:[...new Set((reconciliation?.variances??[]).filter(v=>v.cents!==0).map(v=>v.kind))],asks:asks.map(ask=>({role:ask.role,kind:ask.kind})),acceptedFeeCents:(reconciliation?.acceptedFees??[]).reduce((n,fee)=>n+fee.cents,0),controlViolations:violations,tokensIn:tasks.reduce((n,t)=>n+(t.tokensIn??0),0),tokensOut:tasks.reduce((n,t)=>n+(t.tokensOut??0),0),cacheRead:tasks.reduce((n,t)=>n+(t.cacheRead??0),0),cacheWrite:tasks.reduce((n,t)=>n+(t.cacheWrite??0),0),models:[...new Set(tasks.flatMap(t=>t.model?[t.model]:[]))],errors:tasks.filter(t=>["FAILED","NEEDS_REVIEW"].includes(t.state)).map(t=>t.error??t.state)},apPosted:entries.some(e=>e.kind==="AP")};
}});
export const record=internalMutation({args:{runId:v.id("scoreRuns"),row:v.any()},returns:v.null(),handler:async(ctx,{runId,row})=>{
 const run=await ctx.db.get(runId);if(!run||run.ns!=="score")throw Error("Unknown run");const rows=(run.perVoyage as ScoreRow[]).map(item=>({...item,wallMs:Math.round(item.wallMs)}));if(rows.some(r=>r.code===row.code))return null;rows.push({...row,wallMs:Math.round(row.wallMs)});
 if(rows.length===24)for(const row of rows){const code=(row as ScoreRow&{actualCaseCode?:string}).actualCaseCode;if(!code)continue;const c=await ctx.db.query("cases").withIndex("by_code",q=>q.eq("ns","score").eq("code",code)).unique();const reconciliation=c?.reconciliation as {variances?:{kind:string;cents:number}[]}|undefined;row.actual.disputeLines=[...new Set((reconciliation?.variances??[]).filter(v=>v.cents!==0).map(v=>v.kind))];}
 const models=[...new Set(rows.flatMap(r=>r.actual.models))];await ctx.db.patch(runId,{model:models.join(", ")||run.model,metrics:{...scoreMetrics(rows),wallMs:Date.now()-run.ranAt,status:rows.length===24?"COMPLETE":"RUNNING"},perVoyage:rows});
 const c=await ctx.db.query("cases").withIndex("by_code",q=>q.eq("ns","score").eq("code",String(row.actualCaseCode))).unique();if(c)await ctx.db.patch(c._id,{status:"CLOSED",statusLine:row.actual.errors.length?"Evaluation complete · review":"Evaluation complete",closedAt:Date.now(),updatedAt:Date.now()});
 return null;
}});
export const result=internalQuery({args:{runId:v.id("scoreRuns")},returns:v.any(),handler:async(ctx,{runId})=>{const row=await ctx.db.get(runId);return row&&row.ns==="score"?{id:row._id,ranAt:row.ranAt,model:row.model,voyages:row.voyages,metrics:row.metrics,perVoyage:row.perVoyage}:null;}});

/** Recompute measurements from immutable observed results; no task, answer or posting is replayed. */
export const remeasure=internalMutation({args:{runId:v.id("scoreRuns")},returns:v.null(),handler:async(ctx,{runId})=>{
 const run=await ctx.db.get(runId);if(!run||run.ns!=="score"||(run.perVoyage as ScoreRow[]).length!==24)throw Error("Completed score run required");
 const rows=(run.perVoyage as (ScoreRow&{actualCaseCode:string})[]).map(row=>({...row,actual:{...row.actual},wallMs:Math.round(row.wallMs)}));let completedAt=run.ranAt;
 for(const row of rows){const c=await ctx.db.query("cases").withIndex("by_code",q=>q.eq("ns","score").eq("code",row.actualCaseCode)).unique();if(!c)throw Error("Observed case missing");completedAt=Math.max(completedAt,c.closedAt??run.ranAt);const reconciliation=c.reconciliation as {variances?:{kind:string;cents:number}[]}|undefined;row.actual.disputeLines=[...new Set((reconciliation?.variances??[]).filter(v=>v.cents!==0).map(v=>v.kind))];}
 const metrics={...scoreMetrics(rows),activeWallMs:scoreMetrics(rows).wallMs,wallMs:Math.round(completedAt-run.ranAt),status:"COMPLETE",measurementVersion:2};await ctx.db.patch(runId,{metrics,perVoyage:rows});
 await appendAudit(ctx,{ns:"score",origin:"SYSTEM",actor:"system:score-measurement",role:"agent",type:"SCORE_MEASURED",entityType:"scoreRun",entityId:String(runId),correlationId:`score:${runId}`,details:{measurementVersion:2,providerCalls:0,moneyChanged:false}});return null;
}});

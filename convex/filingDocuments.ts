import { v } from "convex/values";
import { internalQuery, internalMutation, type QueryCtx } from "./_generated/server";
import { currentFacts, loadCase } from "./agent/state";
import { formatUsd } from "../src/domain/money";
import { formatTime } from "../src/lib/format";
import type { EvidenceRef } from "../src/domain/laytime";

function refs(evidence: EvidenceRef[]) { return evidence.map(ref => ref.kind === "DOC" ? ref.documentId : ref.kind === "CLAUSE" ? `${ref.contractId} cl. ${ref.clause}` : ref.kind === "AIS" ? `AIS ${formatTime(ref.from)} - ${formatTime(ref.to)}` : ref.kind === "ASK" ? "Recorded approval" : ref.kind === "MEMORY" ? "Approved memory" : "Journal"); }
async function support(ctx: QueryCtx, b: Awaited<ReturnType<typeof loadCase>>, at: number) {
  return (await ctx.db.query("documents").withIndex("by_ns",q=>q.eq("ns",b.case.ns)).collect()).filter(doc=>doc.vesselId===b.vessel._id && ["SOF","NOR"].includes(doc.kind) && (doc.receivedAt??0)>=b.case.openedAt && (doc.receivedAt??0)<=at).map(doc=>`${doc.code} - ${doc.title}`);
}
export const data = internalQuery({ args:{filingId:v.id("filings")},returns:v.any(),handler:async(ctx,{filingId})=>{
  const filing=await ctx.db.get(filingId);if(!filing||filing.documentId)return null;
  const b=await loadCase(ctx,filing.caseId),party=await ctx.db.get(filing.counterpartyId),facts=await currentFacts(ctx,filing.ns,filing.caseId);
  const reconciliation=b.case.reconciliation as {invoiceCode?:string;variances?:{kind:string;lineId?:string;cents:number;note:string}[]}|undefined;
  const rows=filing.kind==="DISPUTE"?(reconciliation?.variances??[]).map(variance=>{
    const matching=facts.filter(fact=>variance.kind==="LAYTIME_START"?fact.key==="LAYTIME_START_PAYABLE":variance.kind==="COMPLETION_TIME"?fact.key==="COMPLETION":fact.key==="INTERVAL"&&(fact.value as {kind?:string}).kind===variance.kind);
    const evidence=[...new Set(matching.flatMap(fact=>refs(fact.evidence)))];
    return `${variance.note}: ${formatUsd(variance.cents)}. Evidence: ${evidence.join("; ")||reconciliation?.invoiceCode||"Recorded statement"}.`;
  }):[`Claim under ${b.cargo.code}. The amount follows the recorded filing decision.`];
  return {title:filing.kind==="DISPUTE"?"Demurrage dispute":filing.kind==="PROTECTIVE_NOTICE"?"Protective demurrage notice":"Demurrage recovery claim",caseCode:b.case.code,vessel:b.vessel.name,counterparty:party?.name??"Counterparty",cents:filing.cents,filedAt:filing.filedAt,authority:filing.authority.kind==="APPROVAL"?"Recorded approval":filing.authority.kind==="DELEGATION"?filing.authority.policyCode:"Imported",rows,references:[...(await support(ctx,b,filing.filedAt)),...(reconciliation?.invoiceCode&&filing.kind==="DISPUTE"?[reconciliation.invoiceCode]:[])]};
} });
export const attach = internalMutation({args:{filingId:v.id("filings"),storageId:v.id("_storage"),textLayer:v.string()},returns:v.boolean(),handler:async(ctx,{filingId,storageId,textLayer})=>{
  const filing=await ctx.db.get(filingId);if(!filing||filing.documentId)return false;
  const b=await loadCase(ctx,filing.caseId),kind=filing.kind==="DISPUTE"?"DISPUTE_LETTER" as const:"RECOVERY_CLAIM" as const;
  const documentId=await ctx.db.insert("documents",{ns:filing.ns,origin:"AGENT",code:`DOC-${b.case.code}-${filing.kind}`,system:"DOC_STORE",kind,title:`${filing.kind==="DISPUTE"?"Dispute":filing.kind==="PROTECTIVE_NOTICE"?"Protective notice":"Recovery claim"} · ${b.vessel.name}`,vesselId:b.vessel._id,portId:b.port._id,caseId:filing.caseId,storageId,textLayer,receivedAt:filing.filedAt});
  await ctx.db.patch(filingId,{documentId});return true;
} });
export const statementData = internalQuery({args:{statementId:v.id("statements"),issuedAt:v.number()},returns:v.any(),handler:async(ctx,{statementId,issuedAt})=>{
  const statement=await ctx.db.get(statementId);if(!statement)return null;
  const b=await loadCase(ctx,statement.caseId),code=`DOC-${b.case.code}-PAYABLE-V${statement.version}`;
  if(await ctx.db.query("documents").withIndex("by_code",q=>q.eq("ns",statement.ns).eq("code",code)).unique())return null;
  const reconciliation=b.case.reconciliation as {statementVersion?:number;payableCents?:number;acceptedFees?:{label:string;cents:number}[]}|undefined;
  const total=reconciliation?.statementVersion===statement.version?reconciliation.payableCents??statement.totals.totalCents:statement.totals.totalCents;
  return {code,title:`Laytime statement v${statement.version}`,caseCode:b.case.code,vessel:b.vessel.name,counterparty:b.owner.name,cents:total,filedAt:issuedAt,authority:"Deterministic laytime statement",rows:[...statement.lines.map(line=>`${line.note}: ${line.countedMinutes} min${line.clause?` - cl. ${line.clause}`:""}. ${refs(line.evidence).join("; ")}`),...(statement.totals.feesCents===0?(reconciliation?.acceptedFees??[]).map(fee=>`${fee.label}: ${formatUsd(fee.cents)} accepted below materiality.`):[])],references:await support(ctx,b,issuedAt)};
} });
export const attachStatement = internalMutation({args:{statementId:v.id("statements"),issuedAt:v.number(),storageId:v.id("_storage"),textLayer:v.string()},returns:v.boolean(),handler:async(ctx,{statementId,issuedAt,storageId,textLayer})=>{
  const s=await ctx.db.get(statementId);if(!s)return false;const b=await loadCase(ctx,s.caseId),code=`DOC-${b.case.code}-PAYABLE-V${s.version}`;
  if(await ctx.db.query("documents").withIndex("by_code",q=>q.eq("ns",s.ns).eq("code",code)).unique())return false;
  await ctx.db.insert("documents",{ns:s.ns,origin:"AGENT",code,system:"DOC_STORE",kind:"LAYTIME_STATEMENT",title:`Laytime statement v${s.version} · ${b.vessel.name}`,vesselId:b.vessel._id,portId:b.port._id,caseId:s.caseId,storageId,textLayer,receivedAt:issuedAt});return true;
} });

import { parseProcedure, type ProcedurePlan, type ProcedureScope } from '../lib/procedure-schema';
import { reconcileClaim, type CharterTerms, type DelaySegment, type SourceEvidence } from './charters';
import { covers, type Interval } from './intervals';
import { hasInstructionText } from '../lib/agent-schemas';
export type ProcedureInput = { claimType:'DELAY'; clauseFamily:string; voyageId:string; interval:Interval; unexplained:Interval[]; claimedCents:number; charter:CharterTerms; segments:DelaySegment[]; evidence:SourceEvidence[]; archive:(SourceEvidence & { content:string })[]; commercialException?:boolean };
export type ProcedureResult = { status:'APPLIED'|'NEEDS_REVIEW'|'NOT_APPLICABLE'; evidenceIds:string[]; trace:{op:string;outcome:string;sourceIds:string[]}[]; calculation?:ReturnType<typeof reconcileClaim> };
export function matchesScope(scope:ProcedureScope,input:Pick<ProcedureInput,'claimType'|'clauseFamily'|'unexplained'>) { return scope.claimType===input.claimType&&scope.clauseFamilies.includes(input.clauseFamily)&&(!scope.requiresUnexplainedInterval||input.unexplained.length>0); }
export function selectProcedure<T extends { scope:ProcedureScope; status:string }>(procedures:T[],input:Pick<ProcedureInput,'claimType'|'clauseFamily'|'unexplained'>):{status:'MATCH';procedure:T}|{status:'NONE'|'CONFLICT'} {
 const matches=procedures.filter(p=>p.status==='ACTIVE'&&p.scope.archiveAccess==='SIGNED_OPS_LOG'&&matchesScope(p.scope,input)).sort((a,b)=>a.scope.clauseFamilies.length-b.scope.clauseFamilies.length);
 if(!matches.length)return{status:'NONE'};if(matches[1]&&matches[0].scope.clauseFamilies.length===matches[1].scope.clauseFamilies.length)return{status:'CONFLICT'};return{status:'MATCH',procedure:matches[0]};
}
export function interpretProcedure(raw:ProcedurePlan,input:ProcedureInput):ProcedureResult {
 const plan=parseProcedure(raw),trace:ProcedureResult['trace']=[];const result=(status:ProcedureResult['status'],evidenceIds:string[]=[],calculation?:ProcedureResult['calculation']):ProcedureResult=>({status,evidenceIds,trace,...(calculation?{calculation}:{})});
 if(!matchesScope(plan.scope,input))return result('NOT_APPLICABLE');if(input.commercialException)return result('NEEDS_REVIEW');
 let candidates=input.archive.filter(source=>source.type==='SIGNED_OPS_LOG'),selected:SourceEvidence[]=[],segments=[...input.segments];let calculation:ProcedureResult['calculation'];
 for(const step of plan.steps){
  let outcome='OK';
  switch(step.op){
   case 'FIND_EVIDENCE': candidates=candidates.filter(source=>!hasInstructionText(source.content));break;
   case 'VERIFY_EVIDENCE': candidates=candidates.filter(source=>source.voyageId===input.voyageId&&source.signed&&source.cause!=='UNKNOWN');break;
   case 'MATCH_INTERVAL': {
    selected=[];const additions:DelaySegment[]=[];
    for(const window of input.unexplained){const matches=candidates.filter(source=>covers(source,window));if(!matches.length||new Set(matches.map(source=>source.cause)).size!==1){outcome='MISSING_OR_CONFLICTING_EVIDENCE';break;}const source=[...matches].sort((a,b)=>a.id.localeCompare(b.id))[0];selected.push(source);additions.push({...window,cause:source.cause,evidenceIds:[source.id]});}
    if(outcome==='OK')segments=[...segments,...additions];break;
   }
   case 'READ_CHARTER': if(input.charter.effectiveFrom>input.interval.startAt||input.charter.effectiveTo<input.interval.endAt)outcome='CHARTER_NOT_EFFECTIVE';break;
   case 'CLASSIFY_CAUSE': if(!selected.length)outcome='MISSING_CAUSE';break;
   case 'CALCULATE_ELIGIBLE_MINUTES': try{calculation=reconcileClaim({voyageId:input.voyageId,interval:input.interval,claimedCents:input.claimedCents,expectedCharterVersion:input.charter.version,charter:input.charter,segments,evidence:[...input.evidence,...selected]});if(calculation.unverifiedMinutes)outcome='UNRESOLVED_TREATMENT';}catch{outcome='EVIDENCE_OR_CHARTER_CONFLICT';}break;
   case 'ESCALATE_IF_MISSING': if(!calculation||calculation.unverifiedMinutes)outcome='NEEDS_OPERATIONS_REVIEW';break;
   case 'RECORD_FINDING': break;
  }
  trace.push({op:step.op,outcome,sourceIds:[...new Set((selected.length?selected:candidates).map(source=>source.id))]});
  if(outcome!=='OK')return result('NEEDS_REVIEW');
 }
 return calculation?result('APPLIED',[...new Set(selected.map(source=>source.id))],calculation):result('NEEDS_REVIEW');
}

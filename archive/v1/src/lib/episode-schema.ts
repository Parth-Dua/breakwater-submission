import { exact, parseProcedure, record, strings, type ProcedurePlan } from './procedure-schema';
export const classificationLabels=['FACTUAL_CORRECTION','INVESTIGATION_PROCEDURE','COMMERCIAL_EXCEPTION','GOVERNANCE_CHANGE'] as const;
export type Reconstruction={summary:string;observedSteps:{eventId:string;description:string}[];inferredRationale:string[];ambiguities:string[];classifications:(typeof classificationLabels)[number][];proposal:ProcedurePlan|null};
export function parseReconstruction(value:unknown,eventIds:string[]):Reconstruction {
 const result=record(value);exact(result,['summary','observedSteps','inferredRationale','ambiguities','classifications','proposal']);
 if(typeof result.summary!=='string'||!result.summary.trim()||result.summary.length>2000)throw new Error('Bounded summary required');
 if(!Array.isArray(result.observedSteps)||result.observedSteps.length!==eventIds.length)throw new Error('Every actual event must be represented once');
 const observedSteps=result.observedSteps.map((raw,index)=>{const step=record(raw);exact(step,['eventId','description']);if(step.eventId!==eventIds[index]||typeof step.description!=='string'||!step.description.trim()||step.description.length>800)throw new Error('Observed event reference/order mismatch');return{eventId:step.eventId as string,description:step.description};});
 const classifications=strings(result.classifications,4);if(new Set(classifications).size!==classifications.length||classifications.some(label=>!classificationLabels.includes(label as typeof classificationLabels[number])))throw new Error('Unknown classification');
 return{summary:result.summary,observedSteps,inferredRationale:strings(result.inferredRationale,12),ambiguities:strings(result.ambiguities,12),classifications:classifications as Reconstruction['classifications'],proposal:result.proposal===null?null:parseProcedure(result.proposal)};
}
// Schema is a provider output contract; the strict local parser remains authoritative.
const stringArray={type:'array',items:{type:'string'}};
const proposalSchema={
 type:'object', additionalProperties:false, required:['dslVersion','scope','steps'],
 properties:{
  dslVersion:{type:'integer',enum:[1]},
  scope:{type:'object',additionalProperties:false,required:['claimType','clauseFamilies','requiresUnexplainedInterval','archiveAccess'],properties:{claimType:{type:'string',enum:['DELAY']},clauseFamilies:stringArray,requiresUnexplainedInterval:{type:'boolean',enum:[true]},archiveAccess:{type:'string',enum:['SIGNED_OPS_LOG']}}},
  steps:{type:'array',minItems:7,maxItems:8,items:{type:'object',properties:{op:{type:'string',enum:['FIND_EVIDENCE','VERIFY_EVIDENCE','MATCH_INTERVAL','READ_CHARTER','CLASSIFY_CAUSE','CALCULATE_ELIGIBLE_MINUTES','ESCALATE_IF_MISSING','RECORD_FINDING']},type:{type:'string'},repository:{type:'string'},checks:stringArray,target:{type:'string'},field:{type:'string'},source:{type:'string'},role:{type:'string'}}}},
 }
};
export const reconstructionTool={
 name:'record_reconstruction',description:'Describe supplied actual events without inventing actions. Inferred rationale is uncertain. Propose bounded investigation only, never financial authority.',
 input_schema:{type:'object' as const,additionalProperties:false,required:['summary','observedSteps','inferredRationale','ambiguities','classifications','proposal'],properties:{
  summary:{type:'string'},
  observedSteps:{type:'array',items:{type:'object',additionalProperties:false,required:['eventId','description'],properties:{eventId:{type:'string'},description:{type:'string'}}}},
  inferredRationale:stringArray,ambiguities:stringArray,
  classifications:{type:'array',items:{type:'string',enum:[...classificationLabels]}},
  proposal:{anyOf:[{type:'null'},proposalSchema]},
 }}
};

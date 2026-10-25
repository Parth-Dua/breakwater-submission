export type ProcedureScope = { claimType: 'DELAY'; clauseFamilies: string[]; requiresUnexplainedInterval: boolean; archiveAccess: 'NONE' | 'SIGNED_OPS_LOG' };
export type ProcedureStep = { op: string; type?: string; repository?: string; checks?: string[]; target?: string; field?: string; source?: string; role?: string };
export type ProcedurePlan = { dslVersion: 1; scope: ProcedureScope; steps: ProcedureStep[] };
export function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Object required'); return value as Record<string, unknown>; }
export function exact(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) throw new Error('Unexpected or missing schema field'); }
export function strings(value: unknown, max = 20): string[] { if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 1000)) throw new Error('Bounded strings required'); return value as string[]; }
const operators: Record<string, Record<string, unknown>> = {
 FIND_EVIDENCE: { type:'SIGNED_OPS_LOG', repository:'OPS_ARCHIVE' },
 VERIFY_EVIDENCE: { checks:['SAME_VOYAGE','SIGNED','INTERVAL_COVERAGE'] },
 MATCH_INTERVAL: { target:'UNEXPLAINED_INTERVAL' }, READ_CHARTER: { field:'CAUSE_TREATMENT' },
 CLASSIFY_CAUSE: { source:'SIGNED_OPS_LOG' }, CALCULATE_ELIGIBLE_MINUTES: {},
 ESCALATE_IF_MISSING: { role:'OPERATIONS_REVIEWER' }, RECORD_FINDING: {},
};
export function parseProcedure(value: unknown): ProcedurePlan {
 const plan=record(value);exact(plan,['dslVersion','scope','steps']);if(plan.dslVersion!==1)throw new Error('Unsupported DSL version');
 const scope=record(plan.scope);exact(scope,['claimType','clauseFamilies','requiresUnexplainedInterval','archiveAccess']);
 const families=strings(scope.clauseFamilies,8);if(scope.claimType!=='DELAY'||!families.length||new Set(families).size!==families.length||families.some(f=>!/^PORT_DELAY_[A-Z0-9_]+$/.test(f))||scope.requiresUnexplainedInterval!==true||scope.archiveAccess!=='SIGNED_OPS_LOG')throw new Error('Explicit bounded investigation scope required');
 if(!Array.isArray(plan.steps)||plan.steps.length<7||plan.steps.length>8)throw new Error('Seven or eight bounded steps required');
 const steps=plan.steps.map(value=>{const step=record(value),op=step.op;if(typeof op!=='string'||!operators[op])throw new Error('Unknown operator');const fields=operators[op];exact(step,['op',...Object.keys(fields)]);for(const key of Object.keys(fields)){if(key==='checks'){const checks=strings(step[key],3);if(checks.length!==3||new Set(checks).size!==3||checks.some(check=>!(fields.checks as string[]).includes(check)))throw new Error('All evidence checks required');}else if(step[key]!==fields[key])throw new Error('Invalid operator parameter');}return step as ProcedureStep;});
 const required=['FIND_EVIDENCE','VERIFY_EVIDENCE','MATCH_INTERVAL','READ_CHARTER','CLASSIFY_CAUSE','CALCULATE_ELIGIBLE_MINUTES','ESCALATE_IF_MISSING'];
 if(required.some((op,index)=>steps[index]?.op!==op)||steps.length===8&&steps[7].op!=='RECORD_FINDING')throw new Error('Safe dependency order required');
 return {dslVersion:1,scope:{claimType:'DELAY',clauseFamilies:families,requiresUnexplainedInterval:true,archiveAccess:'SIGNED_OPS_LOG'},steps};
}
export const investigationPlan: ProcedurePlan = { dslVersion:1,scope:{claimType:'DELAY',clauseFamilies:['PORT_DELAY_ALPHA','PORT_DELAY_BETA'],requiresUnexplainedInterval:true,archiveAccess:'SIGNED_OPS_LOG'},steps:Object.entries(operators).filter(([op])=>op!=='RECORD_FINDING').map(([op,fields])=>({op,...fields})) };

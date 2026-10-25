import type { EvidenceRef } from "./laytime";
import type { Procedure, ProcedureContext, ProcedureRecord } from "./learning-types";
export type ProcedureOutcome = { result: "VERIFIED" | "ESCALATE" | "NOT_APPLICABLE"; evidence: EvidenceRef[]; trace: string[] };
export type ProcedureIO = { context: ProcedureContext; search: (system: string) => ProcedureRecord[] };
export function matchProcedure(p: Procedure, context: ProcedureContext): boolean {
  return p.dslVersion === 2 && p.trigger.intervalKind === "CUSTOMS_HOLD" && p.trigger.missingEvidence === "CUSTOMS_RELEASE" && !!context.interval && context.missingEvidence && (p.trigger.ports === "ALL" || p.trigger.ports.includes(context.portCode));
}
/** Fixed DSL only: no code, loops, network, money or approval operations. */
export function interpretProcedure(p: Procedure, io: ProcedureIO): ProcedureOutcome {
  const trace: string[] = [], evidence: EvidenceRef[] = [];
  if (!matchProcedure(p, io.context)) return { result: "NOT_APPLICABLE", evidence, trace };
  let records: ProcedureRecord[] = [], verified: ProcedureRecord | undefined, searched = false;
  for (const step of p.steps) {
    trace.push(step.op);
    if (step.op === "SEARCH_SOURCE") { if (step.system !== "CUSTOMS_PORTAL" || !step.match.vessel || !step.match.interval) return { result: "ESCALATE", evidence: [], trace }; records = io.search(step.system); searched = true; }
    else if (step.op === "VERIFY_DOCUMENT") {
      if (!searched || !step.checks.includes("SAME_VESSEL") || !step.checks.includes("COVERS_INTERVAL")) return { result: "ESCALATE", evidence: [], trace };
      verified = records.find(record => record.kind === "RELEASE" && record.vesselId === io.context.vesselId && record.from <= io.context.interval!.from && (record.to ?? 0) >= io.context.interval!.to && (!step.checks.includes("ISSUER_IS_AUTHORITY") || record.authority));
    } else if (step.op === "MARK_VERIFIED") { if (verified) { if (!evidence.some(ref => ref.kind === "DOC" && ref.documentId === verified!.documentCode)) evidence.push({ kind: "DOC", documentId: verified.documentCode }); return { result: "VERIFIED", evidence, trace }; } }
    else if (step.op === "LINK_EVIDENCE" && verified) evidence.push({ kind: "DOC", documentId: verified.documentCode });
    else if (step.op === "ESCALATE_IF_MISSING" && !verified) return { result: "ESCALATE", evidence: [], trace };
  }
  return { result: "ESCALATE", evidence: [], trace };
}

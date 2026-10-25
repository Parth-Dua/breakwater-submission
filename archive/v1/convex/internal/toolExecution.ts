import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { authorizedArchiveProcedure } from "./procedures";
import { getClaimCalculation, accrualBalance } from "../financeCore";
import { claimSnapshot } from "./investigationReads";
import { financialIntervals } from "../../src/domain/claim-timeline";
import { parseToolCall, untrustedDocument, hasInstructionText } from "../../src/lib/agent-schemas";
import { aisGaps } from "../../src/lib/trajectory";
import { formatMoney, formatUtc } from "../../src/lib/format";
export async function ensureOpsTask(ctx: MutationCtx, run: Doc<"agentRuns">) {
  const data = await getClaimCalculation(ctx, run.claimId);
  if (data.claim.revision !== run.revision) throw new Error("STALE_CLAIM_REVISION");
  if (!data.calculation.unverifiedMinutes) return null;
  const operationKey = `ops:${run.claimId}:${run.revision}:MISSING_CAUSE`;
  const existing = await ctx.db.query("workItems").withIndex("by_operation", q => q.eq("operationKey", operationKey)).unique();
  if (existing) return existing._id;
  const windows = financialIntervals(data.voyage, data.segments, { version: data.charter.version, ...data.charter.terms }).filter(interval => interval.treatment === "UNVERIFIED");
  const duration = data.calculation.unverifiedMinutes % 60 === 0 ? `${data.calculation.unverifiedMinutes / 60} hours` : `${data.calculation.unverifiedMinutes} minutes`;
  const question = `What caused the ${duration} of unverified delay on ${data.voyage.voyageCode} (${windows.map(window => `${formatUtc(window.startAt)} — ${formatUtc(window.endAt)}`).join("; ")})? ${formatMoney(data.calculation.unverifiedCents)} requires cause verification. Locate a signed same-voyage Operations log covering the interval. AIS cannot establish cause.`;
  const id = await ctx.db.insert("workItems", { scenarioId: run.scenarioId, synthetic: true, claimId: run.claimId, claimRevision: run.revision, operationKey, amountAtRiskCents: data.calculation.unverifiedCents, affectedIntervals: windows.map(({ startAt, endAt }) => ({ startAt, endAt })), type: "OPS_FACT", assignedRole: "operations_reviewer", status: "OPEN", question, evidenceIds: data.claim.evidenceIds, correlationId: run.correlationId, updatedAt: Date.now() });
  await ctx.db.insert("auditEvents", { scenarioId: run.scenarioId, synthetic: true, actor: "internal:workflow", eventType: "OPERATIONS_QUESTION_CREATED", entityType: "workItem", entityId: id, correlationId: run.correlationId, at: Date.now(), details: { claimId: run.claimId, revision: run.revision, unverifiedCents: data.calculation.unverifiedCents } });
  return id;
}
export async function executeTool(ctx: MutationCtx, run: Doc<"agentRuns">, name: string, raw: string): Promise<{ status: string; result: string; sourceIds: string[] }> {
  const denied = (code: string) => ({ status: "DENIED", result: JSON.stringify({ code }), sourceIds: [] });
  let parsed; try { parsed = parseToolCall(name, JSON.parse(raw)); } catch { return denied("TOOL_SCHEMA_DENIED"); }
  const data = await getClaimCalculation(ctx, run.claimId);
  if (data.claim.revision !== run.revision || data.claim.scenarioId !== run.scenarioId) return denied("STALE_CLAIM_REVISION");
  let result: unknown; let sourceIds: string[] = [];
  const sourceView = (source: Doc<"evidence">) => ({ id: source._id, evidenceCode: source.evidenceCode, type: source.type, signedStatus: source.signedStatus, startAt: source.startAt, endAt: source.endAt, cause: source.cause ?? "UNKNOWN", document: untrustedDocument(source.content) });
  switch (parsed.name) {
    case "get_claim_snapshot": result = await claimSnapshot(ctx, run.claimId); sourceIds = [data.originalInvoice._id, ...data.claim.evidenceIds]; break;
    case "get_voyage_timeline": { const points = await ctx.db.query("aisPoints").withIndex("by_voyage_at", q => q.eq("voyageId", data.voyage._id)).collect(); result = { points: points.map(({ at, lon, lat, heading, quality }) => ({ at, lon, lat, heading, quality })), gaps: aisGaps(points), synthetic: true, establishesCause: false }; sourceIds = points.map(point => point._id); break; }
    case "get_port_events": { const events = await ctx.db.query("portEvents").withIndex("by_voyage_start", q => q.eq("voyageId", data.voyage._id)).collect(); result = events.map(event => ({ startAt: event.startAt, endAt: event.endAt, type: event.type, evidenceId: event.evidenceId })); sourceIds = events.map(event => event.evidenceId); break; }
    case "get_charter_clause": result = { code: data.charter.charterCode, version: data.charter.version, clauseFamily: data.charter.clauseFamily, clauseReference: data.charter.clauseReference, terms: data.charter.terms, synthetic: true }; sourceIds = [data.charter._id]; break;
    case "list_claim_evidence": { const records = await Promise.all(data.claim.evidenceIds.map(id => ctx.db.get(id))); result = records.filter(source => source !== null).map(sourceView); sourceIds = data.claim.evidenceIds; break; }
    case "get_accrual_balance": result = { accrualLiabilityCents: await accrualBalance(ctx, run.claimId), canPost: false }; break;
    case "get_approved_procedures": { const procedures = await ctx.db.query("approvedProcedures").withIndex("by_status", q => q.eq("status", "ACTIVE")).filter(q => q.eq(q.field("scenarioId"), run.scenarioId)).collect(); result = procedures.map(procedure => ({ id: procedure._id, code: procedure.procedureCode, version: procedure.version, scope: procedure.scope, summary: procedure.summary })); sourceIds = procedures.map(procedure => procedure._id); break; }
    case "search_ops_archive": {
      const authority = await authorizedArchiveProcedure(ctx, run, data.charter.clauseFamily, data.calculation.unverifiedMinutes > 0);
      if (!authority) return denied("ARCHIVE_SCOPE_NOT_DELEGATED");
      const sources = await ctx.db.query("evidence").withIndex("by_voyage_type", q => q.eq("voyageId", data.voyage._id).eq("type", "SIGNED_OPS_LOG")).collect();
      const eligible = sources.filter(source => source.scenarioId === run.scenarioId && source.visibility === "OPS_ARCHIVE" && source.withdrawnAt===undefined && source.signedStatus === "SYNTHETIC_SIGNED" && !hasInstructionText(source.content));
      result = { authority: authority._id, sources: eligible.map(sourceView) }; sourceIds = [authority._id, ...eligible.map(source => source._id)]; break;
    }
    case "propose_operational_question": {
      if (hasInstructionText(String(parsed.input.question))) return denied("INSTRUCTION_LIKE_PROPOSAL_REJECTED");
      const windows = financialIntervals(data.voyage, data.segments, { version: data.charter.version, ...data.charter.terms }).filter(interval => interval.treatment === "UNVERIFIED");
      if (!windows.length || parsed.input.startAt !== windows[0].startAt || parsed.input.endAt !== windows[windows.length - 1].endAt) return denied("QUESTION_INTERVAL_DIFFERS_FROM_UNVERIFIED_EVIDENCE");
      result = { workItemId: await ensureOpsTask(ctx, run), deterministicQuestion: true }; break;
    }
    case "propose_financial_resolution": {
      if (hasInstructionText(String(parsed.input.summary))) return denied("INSTRUCTION_LIKE_PROPOSAL_REJECTED");
      if (["supportedCents", "unverifiedCents", "disputedCents"].some(key => parsed.input[key] !== data.calculation[key as keyof typeof data.calculation])) return denied("PROPOSED_AMOUNTS_DIFFER_FROM_VERIFIED_EVIDENCE");
      result = { ...data.calculation, proposalOnly: true, canPost: false }; sourceIds = data.claim.evidenceIds; break;
    }
  }
  return { status: "OK", result: JSON.stringify(result), sourceIds };
}

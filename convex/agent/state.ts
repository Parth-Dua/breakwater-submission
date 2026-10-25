// Case state helpers shared by the agent tools, the runtime and (later) the UI queries.
import { parseMemoryPayload } from "../../src/domain/lesson";
import { matchProcedure } from "../../src/domain/procedures";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getSimNow } from "../lib/clock";
import { caseContextForVoyage } from "../sources/read";
import { resolveCapabilities, type Capability, type CaseContext, type ProcedureGrant } from "../../src/domain/capabilities";
import type { ContractRuleOverride } from "../../src/domain/laytime";

export type CaseBundle = {
  case: Doc<"cases">; voyage: Doc<"voyages">; vessel: Doc<"vessels">; port: Doc<"ports">;
  charter: Doc<"contracts">; cargo: Doc<"contracts">; owner: Doc<"counterparties">; cargoParty: Doc<"counterparties">;
};

export async function loadCase(ctx: QueryCtx, caseId: Id<"cases">): Promise<CaseBundle> {
  const item = await ctx.db.get(caseId);
  if (!item) throw new Error("case not found");
  const voyage = (await ctx.db.get(item.voyageId))!;
  const vessel = (await ctx.db.get(voyage.vesselId))!;
  const port = (await ctx.db.get(voyage.portId))!;
  const charter = (await ctx.db.get(voyage.charterId))!;
  const cargo = (await ctx.db.get(voyage.cargoContractId))!;
  const owner = (await ctx.db.get(charter.counterpartyId))!;
  const cargoParty = (await ctx.db.get(cargo.counterpartyId))!;
  return { case: item, voyage, vessel, port, charter, cargo, owner, cargoParty };
}

export async function caseByCode(ctx: QueryCtx, ns: string, code: string) {
  return ctx.db.query("cases").withIndex("by_code", q => q.eq("ns", ns).eq("code", code)).unique();
}

/** Current (non-superseded) facts of a case. */
export async function currentFacts(ctx: QueryCtx, ns: string, caseId: Id<"cases">) {
  const facts = await ctx.db.query("facts").withIndex("by_case_key", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
  return facts.filter(fact => !fact.supersededBy);
}

export function factValue<T = Record<string, unknown>>(facts: Doc<"facts">[], key: Doc<"facts">["key"]): T | undefined {
  const matches = facts.filter(fact => fact.key === key);
  return matches.length ? (matches[matches.length - 1].value as T) : undefined;
}

export type IntervalFact = { kind: string; startAt: number; endAt: number; verified: boolean; source: string; documentCode?: string; note?: string };
export function intervalFacts(facts: Doc<"facts">[]): (IntervalFact & { factId: Id<"facts"> })[] {
  return facts.filter(fact => fact.key === "INTERVAL").map(fact => ({ ...(fact.value as IntervalFact), factId: fact._id })).sort((a, b) => a.startAt - b.startAt);
}

export async function latestStatement(ctx: QueryCtx, ns: string, caseId: Id<"cases">, side: "PAYABLE" | "RECOVERABLE") {
  const rows = await ctx.db.query("statements").withIndex("by_case_side_version", q => q.eq("ns", ns).eq("caseId", caseId).eq("side", side)).collect();
  return rows.length ? rows[rows.length - 1] : null;
}

/** ACTIVE contract-rule overrides learned for a contract form (LEARNING §3.1). */
export async function activeOverrides(ctx: QueryCtx, ns: string, formCode: string): Promise<ContractRuleOverride[]> {
  const items = await ctx.db.query("memoryItems").withIndex("by_status", q => q.eq("ns", ns).eq("status", "ACTIVE")).collect();
  const overrides: ContractRuleOverride[] = [];
  for (const item of items) {
    const payload = item.payload as { type?: string; formCode?: string; clause?: string; rule?: string; value?: unknown; intervalKind?: string };
    if (payload.type !== "CONTRACT_RULE_OVERRIDE" || payload.formCode !== formCode) continue;
    if (payload.rule === "EXCEPTIONS_APPLY_ON_DEMURRAGE") overrides.push({ memoryItemId: item.code, version: item.version, formCode, clause: payload.clause ?? "", rule: "EXCEPTIONS_APPLY_ON_DEMURRAGE", value: Boolean(payload.value) });
    else if (payload.rule === "TREATMENT" && payload.intervalKind) overrides.push({ memoryItemId: item.code, version: item.version, formCode, clause: payload.clause ?? "", rule: "TREATMENT", intervalKind: payload.intervalKind as never, value: payload.value as never });
  }
  return overrides;
}

/**
 * ACTIVE procedures whose trigger matches the case (LEARNING §7; the full DSL interpreter lands in V10):
 * trigger { intervalKind, missingEvidence } matches when the case has an unverified interval of that kind.
 */
export async function matchingProcedureGrants(ctx: QueryCtx, ns: string, caseId: Id<"cases">, portCode: string): Promise<ProcedureGrant[]> {
  const items = await ctx.db.query("memoryItems").withIndex("by_status", q => q.eq("ns", ns).eq("status", "ACTIVE")).collect();
  const intervals = intervalFacts(await currentFacts(ctx, ns, caseId));
  const item = await ctx.db.get(caseId), voyage = item ? await ctx.db.get(item.voyageId) : null;
  const grants: ProcedureGrant[] = [];
  for (const item of items) {
    const payload = parseMemoryPayload(item.payload);
    if (payload?.type !== "PROCEDURE") continue;
    if (intervals.some(interval => matchProcedure(payload.procedure, { portCode, vesselId: String(voyage?.vesselId ?? ""), interval: { from: interval.startAt, to: interval.endAt }, missingEvidence: interval.kind === payload.procedure.trigger.intervalKind && !interval.verified }))) grants.push({ memoryItemId: item.code, version: item.version, grants: payload.procedure.grants });
  }
  return grants;
}

export async function capabilitiesFor(ctx: QueryCtx, ns: string, caseId: Id<"cases"> | undefined): Promise<{ capabilities: Capability[]; context: CaseContext | null; procedures: ProcedureGrant[] }> {
  if (!caseId) return { capabilities: resolveCapabilities([]), context: null, procedures: [] };
  const bundle = await loadCase(ctx, caseId);
  const procedures = await matchingProcedureGrants(ctx, ns, caseId, bundle.port.code);
  const context = await caseContextForVoyage(ctx, bundle.voyage._id, await getSimNow(ctx, ns));
  return { capabilities: resolveCapabilities(procedures), context, procedures };
}

/** Sum of accrual postings for a case (accruals + true-ups − reversals). */
export async function accruedCents(ctx: QueryCtx, ns: string, caseId: Id<"cases">) {
  const entries = await ctx.db.query("journalEntries").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
  let total = 0;
  for (const entry of entries) {
    if (entry.kind !== "ACCRUAL" && entry.kind !== "ACCRUAL_TRUEUP" && entry.kind !== "ACCRUAL_REVERSAL") continue;
    const lines = await ctx.db.query("journalLines").withIndex("by_entry", q => q.eq("ns", ns).eq("entryId", entry._id)).collect();
    for (const line of lines) if (line.account === "2150") total += line.side === "CREDIT" ? line.cents : -line.cents;
  }
  return total;
}

export async function apPosted(ctx: QueryCtx, ns: string, caseId: Id<"cases">) {
  const entries = await ctx.db.query("journalEntries").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
  return entries.some(entry => entry.kind === "AP");
}

/** Deterministic one-line status for the Desk (≤ 48 chars). */
export async function statusLineFor(ctx: QueryCtx, ns: string, caseId: Id<"cases">): Promise<{ status: Doc<"cases">["status"]; statusLine: string }> {
  const asks = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
  const open = asks.find(ask => ask.status === "OPEN" && ask.kind !== "TEACH_BACK" && ask.kind !== "APPROVE_MEMORY");
  const roleName: Record<string, string> = { ops: "Ops", controller: "Controller", trader: "Trader" };
  if (open) return { status: "WAITING_HUMAN", statusLine: `Waiting · ${roleName[open.role] ?? open.role}` };
  if (await apPosted(ctx, ns, caseId)) return { status: "CLOSED", statusLine: "Payable approved · dispute filed" };
  const filings = await ctx.db.query("filings").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
  if (filings.some(filing => filing.kind === "RECOVERY_CLAIM" || filing.kind === "PROTECTIVE_NOTICE")) return { status: "WAITING_EXTERNAL", statusLine: "Recovery filed · awaiting owner invoice" };
  return { status: "OPEN", statusLine: "Monitoring" };
}

// World import (V02): company, contracts, voyages, periods, policies, scripts and history into a namespace.
// Idempotent: every row is keyed by (ns, code); a second run inserts nothing.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "../_generated/server";
import { appendAudit } from "../lib/audit";
import { ensurePersonas } from "../lib/persona";
import history from "../../fixtures/world/history.json";
import scoreboard from "../../fixtures/world/scoreboard.json";
import { COUNTERPARTIES, FLEET, PORTS } from "../../src/world/company";
import { ACTIVE_CONTRACTS } from "../../src/world/contracts";
import { FORMS } from "../../src/world/forms";
import { PERIODS, POLICIES, POLICY_EFFECTIVE_AT } from "../../src/world/policies";
import { ACTIVE_VOYAGES, ASTER_VALE_PRE_BASELINE, RTM_BASELINE_AT, SCRIPTS, enRouteContracts } from "../../src/world/scripts";
import type { ContractDef, HistoryCase, StatementLineTruth, StatementTruth, VoyageDef } from "../../src/world/types";

const HISTORY = (history as unknown as { cases: HistoryCase[] }).cases;
const SCORE = (scoreboard as unknown as { voyages: HistoryCase[] }).voyages;
const ORIGIN = "HISTORY_IMPORT" as const;

type Counter = { inserted: number };

async function upsertByCode<T extends "counterparties" | "ports" | "vessels" | "contracts" | "voyages" | "periods" | "worldScripts" | "cases">(
  ctx: MutationCtx, table: T, ns: string, code: string, doc: Record<string, unknown>, counter: Counter,
): Promise<Id<T>> {
  const existing = await ctx.db.query(table as "vessels").withIndex("by_code", q => q.eq("ns", ns).eq("code", code)).unique();
  if (existing) return existing._id as Id<T>;
  counter.inserted++;
  return (await ctx.db.insert(table, { ns, origin: ORIGIN, code, ...doc } as never)) as Id<T>;
}

async function idByCode<T extends "counterparties" | "ports" | "vessels" | "contracts" | "voyages">(ctx: MutationCtx, table: T, ns: string, code: string): Promise<Id<T>> {
  const row = await ctx.db.query(table as "vessels").withIndex("by_code", q => q.eq("ns", ns).eq("code", code)).unique();
  if (!row) throw new Error(`${table} ${code} missing in ${ns}`);
  return row._id as unknown as Id<T>;
}

async function insertContract(ctx: MutationCtx, ns: string, contract: ContractDef, counter: Counter) {
  const counterpartyId = await idByCode(ctx, "counterparties", ns, contract.counterpartyCode);
  return upsertByCode(ctx, "contracts", ns, contract.code, { kind: contract.kind, formCode: contract.formCode, counterpartyId, terms: contract.terms }, counter);
}

async function insertVoyage(ctx: MutationCtx, ns: string, voyage: VoyageDef, counter: Counter) {
  return upsertByCode(ctx, "voyages", ns, voyage.code, {
    vesselId: await idByCode(ctx, "vessels", ns, voyage.vesselCode),
    portId: await idByCode(ctx, "ports", ns, voyage.portCode),
    operation: voyage.operation,
    charterId: await idByCode(ctx, "contracts", ns, voyage.charterCode),
    cargoContractId: await idByCode(ctx, "contracts", ns, voyage.cargoContractCode),
    eta: voyage.eta,
  }, counter);
}

/** Company, register, calendar and scripts. */
export const importCompany = internalMutation({
  args: { ns: v.string(), withActive: v.boolean(), allPeriodsOpen: v.boolean() },
  returns: v.number(),
  handler: async (ctx, { ns, withActive, allPeriodsOpen }) => {
    const counter: Counter = { inserted: 0 };
    await ensurePersonas(ctx, ns);
    for (const party of COUNTERPARTIES) await upsertByCode(ctx, "counterparties", ns, party.code, { name: party.name, kind: party.kind, country: party.country, strategic: party.strategic, ...(party.sofTimezoneHabit ? { sofTimezoneHabit: party.sofTimezoneHabit } : {}) }, counter);
    for (const port of PORTS) await upsertByCode(ctx, "ports", ns, port.code, { name: port.name, ianaZone: port.ianaZone, anchorage: port.anchorage, anchorageName: port.anchorageName, berth: port.berth, berthName: port.berthName, customsPortalName: port.customsPortalName }, counter);
    for (const vessel of FLEET) await upsertByCode(ctx, "vessels", ns, vessel.code, { name: vessel.name, imo: vessel.imo, ownerId: await idByCode(ctx, "counterparties", ns, vessel.ownerCode) }, counter);
    for (const period of PERIODS) await upsertByCode(ctx, "periods", ns, period.code, { startAt: period.startAt, endAt: period.endAt, status: allPeriodsOpen ? "OPEN" : period.status, ...(period.lockAt && !allPeriodsOpen ? { lockAt: period.lockAt } : {}) }, counter);
    for (const policy of POLICIES) {
      const existing = await ctx.db.query("policies").withIndex("by_code", q => q.eq("ns", ns).eq("code", policy.code)).unique();
      if (!existing) { counter.inserted++; await ctx.db.insert("policies", { ns, origin: ORIGIN, code: policy.code, params: policy.params, effectiveAt: POLICY_EFFECTIVE_AT, status: "ACTIVE" }); }
    }
    if (withActive) {
      const forms = Object.fromEntries(Object.values(FORMS).map(form => [form.formCode, form.register]));
      for (const contract of [...ACTIVE_CONTRACTS, ...enRouteContracts(forms)]) await insertContract(ctx, ns, contract, counter);
      for (const voyage of ACTIVE_VOYAGES) await insertVoyage(ctx, ns, voyage, counter);
      for (const script of SCRIPTS) await upsertByCode(ctx, "worldScripts", ns, script.code, { anchorAt: script.defaultAnchorAt, status: "IDLE" }, counter);
      const vesselId = await idByCode(ctx, "vessels", ns, "ASTER_VALE");
      const first = await ctx.db.query("aisPoints").withIndex("by_vessel_at", q => q.eq("ns", ns).eq("vesselId", vesselId).eq("at", ASTER_VALE_PRE_BASELINE[0].at)).first();
      if (!first) for (const point of ASTER_VALE_PRE_BASELINE) { counter.inserted++; await ctx.db.insert("aisPoints", { ns, origin: "WORLD_SCRIPT", vesselId, ...point }); }
      const clock = await ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", ns)).first();
      if (!clock) { counter.inserted++; await ctx.db.insert("simClock", { ns, origin: "SYSTEM", simNow: RTM_BASELINE_AT, status: "IDLE", pacing: "1x" }); }
    }
    return counter.inserted;
  },
});

const LINE_NOTES: Record<string, string> = {
  TIME_ON_LAYTIME: "Time from laytime start to completion",
  LAYTIME_ALLOWED: "Laytime allowed",
  SHIFTING: "Shifting to berth",
  PORT_CLOSURE: "Port closed by authority",
  WEATHER: "Weather stoppage",
  CUSTOMS_HOLD: "Customs inspection hold",
  FEE: "Fee",
};

function toStatementLines(truth: StatementTruth) {
  return truth.lines.map((line: StatementLineTruth, index) => ({
    id: `${line.kind}:${line.startAt ?? index}`,
    kind: line.kind as never,
    ...(line.startAt !== undefined ? { startAt: line.startAt } : {}),
    ...(line.endAt !== undefined ? { endAt: line.endAt } : {}),
    minutes: line.minutes, treatment: line.treatment, countedMinutes: line.countedMinutes,
    ...(line.clause ? { clause: line.clause } : {}),
    evidence: [],
    note: line.kind === "FEE" ? line.clause ?? "Fee" : LINE_NOTES[line.kind] ?? line.kind,
  }));
}
const totals = (truth: StatementTruth) => ({ countedMinutes: truth.countedMinutes, laytimeMinutes: truth.laytimeMinutes, demurrageMinutes: truth.demurrageMinutes, demurrageCents: truth.demurrageCents, feesCents: truth.feesCents, totalCents: truth.totalCents, ...(truth.onDemurrageAt !== undefined ? { onDemurrageAt: truth.onDemurrageAt } : {}) });

/** One closed history case with its statements, edits, facts, AIS and journals (single transaction). */
export const importHistoryCase = internalMutation({
  args: { ns: v.string(), index: v.number() },
  returns: v.number(),
  handler: async (ctx, { ns, index }) => {
    const item = HISTORY[index];
    const counter: Counter = { inserted: 0 };
    const existing = await ctx.db.query("cases").withIndex("by_code", q => q.eq("ns", ns).eq("code", item.caseCode)).unique();
    if (existing) return 0;
    const cpForm = FORMS[item.voyage.charterCode.split("/")[0]];
    const cargoForm = FORMS[item.voyage.cargoContractCode.replace(/-H\d+$/, "")];
    await insertContract(ctx, ns, { code: item.voyage.charterCode, kind: "CHARTER_PARTY", formCode: cpForm.formCode, counterpartyCode: cpForm.counterpartyCode, terms: cpForm.register, documentCode: cpForm.documentCode }, counter);
    await insertContract(ctx, ns, { code: item.voyage.cargoContractCode, kind: cargoForm.kind, formCode: cargoForm.formCode, counterpartyCode: cargoForm.counterpartyCode, terms: cargoForm.register, documentCode: cargoForm.documentCode }, counter);
    const voyageId = await insertVoyage(ctx, ns, item.voyage, counter);
    const vesselId = await idByCode(ctx, "vessels", ns, item.voyage.vesselCode);
    for (const point of item.ais) await ctx.db.insert("aisPoints", { ns, origin: ORIGIN, vesselId, ...point });
    counter.inserted += item.ais.length;

    const caseId = await ctx.db.insert("cases", {
      ns, origin: ORIGIN, code: item.caseCode, voyageId, status: "CLOSED", openedAt: item.openedAt, closedAt: item.closedAt,
      statusLine: item.outcome.waiverCents ? "Closed · waiver recorded" : item.outcome.disputedCents ? "Closed · dispute settled" : "Closed",
      billedCents: item.ownerInvoice.totalCents, disputedCents: item.outcome.disputedCents,
      correlationId: `case:${item.caseCode}`, updatedAt: item.closedAt,
    });
    counter.inserted++;
    const charterId = await idByCode(ctx, "contracts", ns, item.voyage.charterCode);
    const cargoId = await idByCode(ctx, "contracts", ns, item.voyage.cargoContractCode);
    const payableId = await ctx.db.insert("statements", { ns, origin: ORIGIN, caseId, side: "PAYABLE", version: 1, contractId: charterId, laytimeStartAt: item.truth.payable.laytimeStartAt, completionAt: item.completionAt, lines: toStatementLines(item.truth.payable), totals: totals(item.truth.payable), computedAt: item.closedAt, memoryItemIds: [] });
    const recoverableId = await ctx.db.insert("statements", { ns, origin: ORIGIN, caseId, side: "RECOVERABLE", version: 1, contractId: cargoId, laytimeStartAt: item.truth.recoverable.laytimeStartAt, completionAt: item.completionAt, lines: toStatementLines(item.truth.recoverable), totals: totals(item.truth.recoverable), computedAt: item.closedAt, memoryItemIds: [] });
    counter.inserted += 2;
    await ctx.db.patch(caseId, { payable: { statementId: payableId, totalCents: item.truth.payable.totalCents, version: 1 }, recoverable: { statementId: recoverableId, totalCents: item.outcome.recoveredCents, version: 1 } });
    for (const edit of item.edits) {
      const line = item.truth.payable.lines.find(candidate => candidate.kind === edit.lineKind);
      await ctx.db.insert("statementEdits", { ns, origin: ORIGIN, statementId: payableId, lineId: `${edit.lineKind}:${line?.startAt ?? 0}`, field: "treatment", from: edit.from, to: edit.to, basis: { clause: edit.clause, note: edit.note }, at: item.closedAt, status: "APPLIED" });
      counter.inserted++;
    }
    for (const interval of item.intervals.filter(candidate => candidate.kind === "CUSTOMS_HOLD")) {
      await ctx.db.insert("facts", { ns, origin: ORIGIN, caseId, key: "INTERVAL", value: { kind: "CUSTOMS_HOLD", startAt: interval.startAt, endAt: interval.endAt, verified: item.outcome.customsResolution === "VERIFIED", resolution: item.outcome.customsResolution, sourceUsed: item.outcome.sourceUsed }, evidence: [], establishedBy: "HUMAN", at: item.completionAt });
      counter.inserted++;
    }
    for (const journal of item.journals) {
      const entryId = await ctx.db.insert("journalEntries", { ns, origin: ORIGIN, code: journal.code, caseId, periodCode: journal.periodCode, kind: journal.kind, idempotencyKey: journal.code, authority: { kind: "IMPORTED" }, evidence: [], memo: journal.memo, postedAt: journal.postedAt, postedWallAt: journal.postedAt });
      for (const line of journal.lines) {
        const counterpartyId = line.counterpartyCode ? await idByCode(ctx, "counterparties", ns, line.counterpartyCode) : undefined;
        await ctx.db.insert("journalLines", { ns, origin: ORIGIN, entryId, account: line.account, side: line.side, cents: line.cents, ...(counterpartyId ? { counterpartyId } : {}) });
      }
      counter.inserted += 1 + journal.lines.length;
    }
    if (item.outcome.waiverCents) {
      await ctx.db.insert("memoryItems", {
        ns, origin: ORIGIN, code: `M-H${String(index).padStart(3, "0")}`, kind: "PRECEDENT", status: "PRECEDENT_ONLY",
        title: `Pampas goodwill waiver $${(item.outcome.waiverCents / 100).toLocaleString("en-US")}`,
        payload: { type: "PRECEDENT", summary: item.outcome.waiverReason, counterpartyCode: item.voyage.cargoContractCode.startsWith("PAMPAS") ? "PAMPAS" : undefined, amountCents: item.outcome.waiverCents },
        scope: { kind: "THIS_CASE", value: item.caseCode }, sourceCaseId: caseId, version: 1, usedIn: [], createdAt: item.closedAt,
      });
      counter.inserted++;
    }
    return counter.inserted;
  },
});

/** Score namespace: contracts and voyages for the 24 held-out voyages (events are attached by the score runner). */
export const importScoreVoyage = internalMutation({
  args: { index: v.number() },
  returns: v.number(),
  handler: async (ctx, { index }) => {
    const ns = "score";
    const item = SCORE[index];
    const counter: Counter = { inserted: 0 };
    const cpForm = FORMS[item.voyage.charterCode.split("/")[0]];
    const cargoForm = FORMS[item.voyage.cargoContractCode.replace(/-SC-\d+$/, "")];
    // Scoreboard registers match the signed contracts (WORLD §8): agent errors are the agent's, not the data's.
    await insertContract(ctx, ns, { code: item.voyage.charterCode, kind: "CHARTER_PARTY", formCode: cpForm.formCode, counterpartyCode: cpForm.counterpartyCode, terms: cpForm.truth, documentCode: cpForm.documentCode }, counter);
    await insertContract(ctx, ns, { code: item.voyage.cargoContractCode, kind: cargoForm.kind, formCode: cargoForm.formCode, counterpartyCode: cargoForm.counterpartyCode, terms: cargoForm.truth, documentCode: cargoForm.documentCode }, counter);
    await insertVoyage(ctx, ns, item.voyage, counter);
    return counter.inserted;
  },
});

export const recordImport = internalMutation({
  args: { ns: v.string(), inserted: v.number() },
  returns: v.null(),
  handler: async (ctx, { ns, inserted }) => {
    await appendAudit(ctx, { ns, origin: "SYSTEM", actor: "system", role: "agent", type: "WORLD_IMPORTED", entityType: "namespace", entityId: ns, correlationId: `import:${ns}`, details: { inserted } });
    return null;
  },
});

/** `npx convex run world/import:importAll '{"ns":"demo"}'` — idempotent; returns rows inserted. */
export const importAll = internalAction({
  args: { ns: v.union(v.literal("demo"), v.literal("score"), v.string()) },
  returns: v.object({ ns: v.string(), inserted: v.number(), historyCases: v.number(), scoreVoyages: v.number() }),
  handler: async (ctx, { ns }): Promise<{ ns: string; inserted: number; historyCases: number; scoreVoyages: number }> => {
    const isScore = ns === "score";
    let inserted: number = await ctx.runMutation(internal.world.import.importCompany, { ns, withActive: !isScore, allPeriodsOpen: isScore });
    let historyCases = 0, scoreVoyages = 0;
    if (isScore) {
      for (let index = 0; index < SCORE.length; index++) { const added: number = await ctx.runMutation(internal.world.import.importScoreVoyage, { index }); inserted += added; scoreVoyages++; }
    } else {
      for (let index = 0; index < HISTORY.length; index++) { const added: number = await ctx.runMutation(internal.world.import.importHistoryCase, { ns, index }); inserted += added; historyCases++; }
    }
    if (inserted > 0) await ctx.runMutation(internal.world.import.recordImport, { ns, inserted });
    return { ns, inserted, historyCases, scoreVoyages };
  },
});

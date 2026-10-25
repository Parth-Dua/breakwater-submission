import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { activeOverrides, currentFacts, intervalFacts, latestStatement, loadCase } from "./agent/state";
import { computeStatement, type IntervalInput } from "../src/domain/laytime";
import { proRataCents } from "../src/domain/money";
import type { Treatment } from "../src/world/types";
import { automationArg, askForHuman, eventsFor, humanOrigin, recordHuman, startHuman } from "./human";
import { editBasis } from "./lib/validators";
import { currentPersona } from "./lib/persona";
import { fail } from "./lib/errors";
import { getSimNow } from "./lib/clock";
import { loadPolicies } from "./gateway";
import { evidenceViews } from "./room";

export async function previewFor(ctx: QueryCtx, ask: Doc<"asks">, personaId: string) {
  const b = await loadCase(ctx, ask.caseId), statement = await latestStatement(ctx, ask.ns, ask.caseId, "PAYABLE");
  if (!statement) fail("MISSING_EVIDENCE", "No payable statement");
  const edits = await ctx.db.query("statementEdits").withIndex("by_statement", q => q.eq("ns", ask.ns).eq("statementId", statement._id)).collect();
  const own = edits.filter(edit => edit.status === "DRAFT" && edit.personaId === personaId), applied = edits.filter(edit => edit.status === "APPLIED");
  const facts = await currentFacts(ctx, ask.ns, ask.caseId);
  const intervals: IntervalInput[] = intervalFacts(facts).map(interval => ({ kind: interval.kind as IntervalInput["kind"], startAt: interval.startAt, endAt: interval.endAt, verified: interval.verified, evidence: facts.find(fact => fact._id === interval.factId)?.evidence ?? [] }));
  const invoice = b.case.reconciliation as { acceptedFees?: { label: string; cents: number }[]; invoiceCode?: string } | undefined;
  const result = computeStatement({ side: "PAYABLE", terms: b.charter.terms, formCode: b.charter.formCode, contractId: b.charter.code, laytimeStartAt: statement.laytimeStartAt, completionAt: statement.completionAt, intervals, fees: (invoice?.acceptedFees ?? []).map(fee => ({ ...fee, evidence: invoice?.invoiceCode ? [{ kind: "DOC" as const, documentId: invoice.invoiceCode }] : [] })), overrides: await activeOverrides(ctx, ask.ns, b.charter.formCode), edits: [...applied, ...own].map(edit => ({ editId: String(edit._id), lineId: edit.lineId, treatment: edit.to as Treatment })) });
  const clauses = [...new Set(["5(c)", "laytime", ...Object.values(b.charter.terms.treatments).map(rule => rule.clause)])];
  const reconciliation = b.case.reconciliation as { variances?: { kind?: string; lineId?: string; cents: number; minutes: number }[] } | undefined;
  return { b, statement, own, applied, result, clauses, reconciliation };
}
export const preview = query({ args: { askCode: v.string() }, returns: v.any(), handler: async (ctx, { askCode }) => {
  const acting = await currentPersona(ctx);
  const ask = await ctx.db.query("asks").withIndex("by_code", q => q.eq("ns", "demo").eq("code", askCode)).unique();
  if (!acting || acting.persona.role !== "controller" || !ask || ask.kind !== "PAYMENT_APPROVAL" || ask.status !== "OPEN") return null;
  const p = await previewFor(ctx, ask, acting.persona._id), policies = await loadPolicies(ctx, ask.ns);
  return { version: p.statement.version, editIds: p.own.map(edit => String(edit._id)), totals: p.result.totals, disputeCents: Math.max(0, (p.b.case.billedCents ?? 0) - p.result.totals.totalCents), limitCents: Number(policies.AP_POSTING?.maxCents ?? 0), clauses: p.clauses, contractDocumentCode: p.b.charter.documentId ? (await ctx.db.get(p.b.charter.documentId))?.code : null,
    lines: await Promise.all(p.result.lines.map(line => { const old = p.statement.lines.find(old => old.id === line.id)!, variances = p.reconciliation?.variances?.filter(variance => variance.lineId === line.id) ?? []; const editable = ["SHIFTING", "PORT_CLOSURE", "WEATHER", "CUSTOMS_HOLD"].includes(line.kind); return evidenceViews(ctx, line.evidence).then(evidence => ({ ...line, evidence, editable, ownerMinutes: line.kind === "FEE" ? null : line.kind === "TIME_ON_LAYTIME" ? line.minutes + variances.reduce((sum, variance) => sum + variance.minutes, 0) : line.kind === "LAYTIME_ALLOWED" ? line.countedMinutes : line.minutes, deltaCents: editable ? proRataCents(Math.max(0, -line.countedMinutes), p.b.charter.terms.ratePerHourCents) : variances.reduce((sum, variance) => sum + variance.cents, 0), originalTreatment: old?.treatment, basis: p.own.find(edit => edit.lineId === line.id)?.basis ?? null })); })) };
} });
export const editLine = mutation({
  args: { askCode: v.string(), lineId: v.string(), field: v.literal("treatment"), to: v.union(v.literal("COUNT"), v.literal("EXCLUDE"), v.literal("HALF")), basis: editBasis, expectedVersion: v.number(), ...automationArg }, returns: v.any(),
  handler: async (ctx, { askCode, lineId, to, basis, expectedVersion, automation }) => {
    const { ask, acting } = await askForHuman(ctx, askCode, ["PAYMENT_APPROVAL"]), p = await previewFor(ctx, ask, acting.persona._id);
    if (expectedVersion !== p.statement.version) fail("STALE_VERSION", "Statement changed; reopen this line");
    const line = p.statement.lines.find(line => line.id === lineId);
    if (!line || !["SHIFTING", "PORT_CLOSURE", "WEATHER", "CUSTOMS_HOLD"].includes(line.kind)) fail("NOT_PERMITTED", "This line cannot be edited");
    if (!basis.clause || !p.clauses.includes(basis.clause) || !basis.note.trim() || basis.note.length > 80) fail("MISSING_EVIDENCE", "Choose a clause and add a note of at most 80 characters");
    const document = p.b.charter.documentId ? await ctx.db.get(p.b.charter.documentId) : null;
    if (basis.documentId && basis.documentId !== document?.code) fail("MISSING_EVIDENCE", "Use this case's charter party");
    await startHuman(ctx, ask, acting, automation);
    for (const prior of p.own.filter(edit => edit.lineId === lineId)) await ctx.db.patch(prior._id, { status: "DISCARDED" });
    const editId = await ctx.db.insert("statementEdits", { ns: ask.ns, origin: humanOrigin(automation), statementId: p.statement._id, personaId: acting.persona._id, lineId, field: "treatment", from: line.treatment, to, basis: { ...basis, note: basis.note.trim(), ...(document ? { documentId: document.code } : {}) }, at: await getSimNow(ctx, ask.ns), status: "DRAFT" });
    await recordHuman(ctx, ask, acting, "LINE_EDITED", { editId: String(editId), lineId, lineKind: line.kind, from: line.treatment, to, basis, statementVersion: p.statement.version }, automation);
    const next = await previewFor(ctx, ask, acting.persona._id);
    return { editId: String(editId), version: next.statement.version, totals: next.result.totals };
  },
});

/** Approval applies exactly the submitted current drafts. No posting occurs here. */
export async function applyDraftEdits(ctx: MutationCtx, ask: Doc<"asks">, personaId: string, editIds: string[], expectedVersion: number | undefined, approve: boolean, automation?: boolean) {
  const p = await previewFor(ctx, ask, personaId);
  if (expectedVersion !== p.statement.version) fail("STALE_VERSION", "Statement changed; review the latest version");
  const events = await eventsFor(ctx, ask);
  if (new Set(editIds).size !== editIds.length || editIds.some(id => !p.own.some(edit => String(edit._id) === id) || !events.some(event => event.personaId === personaId && event.type === "LINE_EDITED" && (event.payload as { editId?: string }).editId === id)) || approve && p.own.some(edit => !editIds.includes(String(edit._id)))) fail("STALE_VERSION", "Review the current edits before submitting");
  for (const edit of p.own) await ctx.db.patch(edit._id, { status: approve ? "APPLIED" : "DISCARDED" });
  if (!approve) return;
  if (p.own.length) {
    const version = p.statement.version + 1;
    const statementId = await ctx.db.insert("statements", { ns: ask.ns, origin: humanOrigin(automation), caseId: ask.caseId, side: "PAYABLE", version, contractId: p.statement.contractId, laytimeStartAt: p.statement.laytimeStartAt, completionAt: p.statement.completionAt, lines: p.result.lines, totals: p.result.totals, computedAt: await getSimNow(ctx, ask.ns), memoryItemIds: p.result.memoryItemIds });
    for (const edit of [...p.applied, ...p.own]) { const { _id, _creationTime, ...body } = edit; void _id; void _creationTime; await ctx.db.insert("statementEdits", { ...body, statementId, status: "APPLIED" }); }
    await ctx.scheduler.runAfter(0, internal.node.documents.renderStatement, { statementId, issuedAt: await getSimNow(ctx, ask.ns) });
    // Reconciliation keeps its prior version: post_ap must re-reconcile this changed statement before posting.
    await ctx.db.patch(ask.caseId, { payable: { statementId: String(statementId), totalCents: p.result.totals.totalCents, version }, updatedAt: Date.now() });
  }
  await ctx.db.patch(ask._id, { context: { ...ask.context, approvedCents: p.result.totals.totalCents } });
}

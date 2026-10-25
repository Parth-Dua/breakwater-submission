// Gateway (ARCHITECTURE §7, CONTRACTS §7–8): the only writer to the books, outbound filings and asks.
// Internal only. Every write re-validates authority and invariants and audits atomically in the same transaction.
import { internal } from "./_generated/api";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { appendAudit } from "./lib/audit";
import { fail } from "./lib/errors";
import { askContext, askOption, authority as authorityValidator, evidenceRef, role as roleValidator } from "./lib/validators";
import { draftTotal, validateJournal, type JournalDraft } from "../src/domain/ledger";
import { deadlineFallbackDue, routeAsk, withinDelegation, type DelegationContext, type Need, type PolicySet } from "../src/domain/policy";

type Authority = Infer<typeof authorityValidator>;
type Evidence = Infer<typeof evidenceRef>;
type Actor = { actor: string; role: Infer<typeof roleValidator>; correlationId: string };

export async function loadPolicies(ctx: QueryCtx, ns: string): Promise<PolicySet> {
  const rows = await ctx.db.query("policies").withIndex("by_ns", q => q.eq("ns", ns)).collect();
  return Object.fromEntries(rows.filter(row => row.status === "ACTIVE").map(row => [row.code, row.params as Record<string, unknown>]));
}

export async function periodAt(ctx: QueryCtx, ns: string, at: number) {
  const periods = await ctx.db.query("periods").withIndex("by_ns", q => q.eq("ns", ns)).collect();
  return periods.find(period => at >= period.startAt && at < period.endAt) ?? null;
}

async function requireDeadlineFallback(ctx: QueryCtx, ns: string, caseId: Id<"cases"> | undefined, at: number, policies: PolicySet) {
  const item = caseId ? await ctx.db.get(caseId) : null;
  if (!item || item.ns !== ns) fail("NOT_PERMITTED", "Protective filing needs a case in this namespace");
  const voyage = (await ctx.db.get(item.voyageId))!;
  const cargo = (await ctx.db.get(voyage.cargoContractId))!;
  const completions = await ctx.db.query("facts").withIndex("by_case_key", q => q.eq("ns", ns).eq("caseId", item._id).eq("key", "COMPLETION")).collect();
  const completion = completions.filter(fact => !fact.supersededBy).at(-1)?.value as { at?: number } | undefined;
  const timeBarAt = completion?.at !== undefined && cargo.terms.timeBar ? completion.at + cargo.terms.timeBar.days * 86_400_000 : null;
  const asks = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", item._id)).collect();
  if (timeBarAt === null || !asks.some(ask => deadlineFallbackDue(ask, at, timeBarAt, policies))) fail("NOT_PERMITTED", "Protective filing is outside the authorized deadline window");
}

const DELEGATION_FOR: Partial<Record<JournalDraft["kind"], "AP_POSTING" | "ACCRUAL" | "RECOVERY_FILING">> = {
  ACCRUAL: "ACCRUAL", ACCRUAL_TRUEUP: "ACCRUAL", ACCRUAL_REVERSAL: "AP_POSTING", AP: "AP_POSTING", AR_RECOVERY: "RECOVERY_FILING",
};

/** Validates and posts one journal. Idempotent by key: a repeat returns the existing entry and writes nothing. */
export async function postJournalTx(ctx: MutationCtx, input: {
  ns: string; draft: JournalDraft; caseId?: Id<"cases">; postedAt: number; idempotencyKey: string;
  authority: Authority; evidence: Evidence[]; delegation?: DelegationContext; origin?: "AGENT" | "HUMAN";
} & Actor): Promise<Id<"journalEntries">> {
  const { ns, draft } = input;
  const existing = await ctx.db.query("journalEntries").withIndex("by_idempotency", q => q.eq("ns", ns).eq("idempotencyKey", input.idempotencyKey)).unique();
  if (existing) return existing._id;
  if (!input.evidence.length) fail("MISSING_EVIDENCE", "Journals must reference evidence");
  const period = await periodAt(ctx, ns, input.postedAt);
  if (!period) fail("PERIOD_LOCKED", "No fiscal period for this date");
  const check = validateJournal(draft, period, input.postedAt);
  if (!check.ok) {
    if (check.code === "PERIOD_LOCKED" || check.code === "OUT_OF_PERIOD") fail("PERIOD_LOCKED", `${period.code} is closed`);
    fail("UNBALANCED", check.code);
  }
  const total = draftTotal(draft);
  if (input.authority.kind === "DELEGATION") {
    const action = DELEGATION_FOR[draft.kind];
    const policies = await loadPolicies(ctx, ns);
    const protective = input.authority.policyCode === "DEADLINE_FALLBACK" && draft.kind === "AR_RECOVERY" && Boolean(policies.DEADLINE_FALLBACK); // REQ-AGT-07
    if (protective) await requireDeadlineFallback(ctx, ns, input.caseId, input.postedAt, policies);
    if (!protective && (!action || input.authority.policyCode !== action || !withinDelegation(action, total, input.delegation ?? {}, policies))) fail("OVER_DELEGATION", `${draft.kind} ${total} exceeds ${input.authority.policyCode}`);
  } else if (input.authority.kind === "APPROVAL") {
    const ask = await ctx.db.get(input.authority.askId as Id<"asks">);
    if (!ask || ask.ns !== ns || ask.caseId !== input.caseId || ask.status !== "ANSWERED" || !ask.answeredBy || String(ask.answeredBy) !== input.authority.personaId) fail("NOT_PERMITTED", "Approval not found for this case");
    const recovery = draft.kind === "AR_RECOVERY";
    const approver = await ctx.db.get(ask.answeredBy);
    if (!approver || approver.ns !== ns || approver.role !== (recovery ? "trader" : "controller") || ask.role !== approver.role || ask.kind !== (recovery ? "COMMERCIAL_DECISION" : "PAYMENT_APPROVAL")) fail("SOD_VIOLATION", "Approval must come from the role responsible for this action");
    if (!ask.answer || !(recovery ? ["PURSUE", "PARTIAL"] : ["APPROVE"]).includes(ask.answer.optionId)) fail("NOT_PERMITTED", "This answer does not authorize posting");
    if (draft.kind === "AP" && ask.context.approvedCents !== undefined && total !== ask.context.approvedCents) fail("STALE_VERSION", "Payable changed after approval");
    if (input.actor === `persona:${approver.code}`) fail("SOD_VIOLATION", "Approver cannot post their own approval");
  } else {
    fail("NOT_PERMITTED", "Imported authority is reserved for history");
  }
  const sequence = (await ctx.db.query("journalEntries").withIndex("by_period", q => q.eq("ns", ns).eq("periodCode", period.code)).collect()).length + 1;
  const code = `JE-${period.code}-${String(sequence).padStart(4, "0")}`;
  const entryId = await ctx.db.insert("journalEntries", {
    ns, origin: input.origin ?? "AGENT", code, periodCode: period.code, kind: draft.kind, idempotencyKey: input.idempotencyKey,
    authority: input.authority, evidence: input.evidence, memo: draft.memo, postedAt: input.postedAt, postedWallAt: Date.now(),
    ...(input.caseId ? { caseId: input.caseId } : {}),
  });
  for (const line of draft.lines) {
    await ctx.db.insert("journalLines", { ns, origin: input.origin ?? "AGENT", entryId, account: line.account, side: line.side, cents: line.cents, ...(line.counterpartyId ? { counterpartyId: line.counterpartyId as Id<"counterparties"> } : {}) });
  }
  await appendAudit(ctx, { ns, origin: input.origin ?? "AGENT", actor: input.actor, role: input.role, type: "JOURNAL_POSTED", entityType: "journalEntry", entityId: code, correlationId: input.correlationId, after: { code, kind: draft.kind, totalCents: total, periodCode: period.code, authority: input.authority }, evidence: input.evidence, at: input.postedAt });
  return entryId;
}

/** Files a recovery claim or protective notice and recognizes the receivable (PRUDENCE). Idempotent per case and kind. */
export async function fileRecoveryTx(ctx: MutationCtx, input: {
  ns: string; caseId: Id<"cases">; counterpartyId: Id<"counterparties">; cents: number; kind: "RECOVERY_CLAIM" | "PROTECTIVE_NOTICE";
  authority: Authority; documentId?: Id<"documents">; filedAt: number; evidence: Evidence[]; counterpartyStrategic: boolean;
} & Actor): Promise<Id<"filings">> {
  const prior = await ctx.db.query("filings").withIndex("by_case", q => q.eq("ns", input.ns).eq("caseId", input.caseId)).collect();
  const existing = prior.find(filing => filing.kind === "RECOVERY_CLAIM" || filing.kind === "PROTECTIVE_NOTICE");
  if (existing) return existing._id;
  const item = await ctx.db.get(input.caseId);
  const filingId = await ctx.db.insert("filings", {
    ns: input.ns, origin: "AGENT", caseId: input.caseId, kind: input.kind, counterpartyId: input.counterpartyId, cents: input.cents,
    filedAt: input.filedAt, authority: input.authority, ...(input.documentId ? { documentId: input.documentId } : {}),
  });
  const draft: JournalDraft = { kind: "AR_RECOVERY", memo: `Demurrage claim filed · ${item?.code ?? ""}`, lines: [
    { account: "1200", counterpartyId: input.counterpartyId, side: "DEBIT", cents: input.cents }, { account: "5190", side: "CREDIT", cents: input.cents },
  ] };
  await postJournalTx(ctx, { ...input, draft, postedAt: input.filedAt, idempotencyKey: `filing:${input.caseId}:recovery`, delegation: { counterpartyStrategic: input.counterpartyStrategic } });
  await appendAudit(ctx, { ns: input.ns, origin: "AGENT", actor: input.actor, role: input.role, type: input.kind === "PROTECTIVE_NOTICE" ? "PROTECTIVE_NOTICE_FILED" : "RECOVERY_FILED", entityType: "filing", entityId: String(filingId), correlationId: input.correlationId, after: { cents: input.cents, kind: input.kind }, evidence: input.evidence, at: input.filedAt });
  await ctx.scheduler.runAfter(0, internal.node.documents.renderFiling, { filingId });
  return filingId;
}

/** Records a dispute with the owner (not booked: PRUDENCE). Idempotent per case. */
export async function recordDisputeTx(ctx: MutationCtx, input: { ns: string; caseId: Id<"cases">; counterpartyId: Id<"counterparties">; cents: number; authority: Authority; documentId?: Id<"documents">; filedAt: number; evidence: Evidence[] } & Actor) {
  const prior = await ctx.db.query("filings").withIndex("by_case", q => q.eq("ns", input.ns).eq("caseId", input.caseId)).collect();
  const existing = prior.find(filing => filing.kind === "DISPUTE");
  if (existing) return existing._id;
  const filingId = await ctx.db.insert("filings", { ns: input.ns, origin: "AGENT", caseId: input.caseId, kind: "DISPUTE", counterpartyId: input.counterpartyId, cents: input.cents, filedAt: input.filedAt, authority: input.authority, ...(input.documentId ? { documentId: input.documentId } : {}) });
  await ctx.db.patch(input.caseId, { disputedCents: input.cents });
  await appendAudit(ctx, { ns: input.ns, origin: "AGENT", actor: input.actor, role: input.role, type: "DISPUTE_RECORDED", entityType: "filing", entityId: String(filingId), correlationId: input.correlationId, after: { cents: input.cents }, evidence: input.evidence, at: input.filedAt });
  await ctx.scheduler.runAfter(0, internal.node.documents.renderFiling, { filingId });
  return filingId;
}

const KIND_FOR_NEED: Record<Need, Doc<"asks">["kind"]> = { FACT: "CONFIRM_FACT", PAYMENT: "PAYMENT_APPROVAL", RECOVERY_FILING: "COMMERCIAL_DECISION", WAIVER: "COMMERCIAL_DECISION", MEMORY: "APPROVE_MEMORY" };

/** Creates an ask routed by policy (CONTRACTS §8). The caller states the need; the role is decided here. */
/** Case-scoped ask codes from the vessel name (WORLD §5.6, §6): Aster Vale → A-1, A-2; Kestrel → K-1. */
async function askCode(ctx: MutationCtx, ns: string, caseId: Id<"cases">, n: number) {
  const item = (await ctx.db.get(caseId))!;
  const voyage = (await ctx.db.get(item.voyageId))!;
  const name = ((await ctx.db.get(voyage.vesselId))?.name ?? "X").replace(/^MV\s+/i, "").replace(/[^A-Za-z]/g, "").toUpperCase();
  for (let length = 1; length <= name.length; length++) {
    const code = `${name.slice(0, length)}-${n}`;
    const taken = await ctx.db.query("asks").withIndex("by_code", q => q.eq("ns", ns).eq("code", code)).unique();
    if (!taken || taken.caseId === caseId) return code;
  }
  return `${name}-${n}-${String(caseId).slice(-4)}`;
}

export async function createAskTx(ctx: MutationCtx, input: {
  ns: string; caseId: Id<"cases">; need: Need; question: string; subject: string;
  options: Infer<typeof askOption>[]; context: Infer<typeof askContext>; amountAtRiskCents?: number; deadlineAt?: number; delegation?: DelegationContext; createdAt: number;
} & Actor): Promise<Id<"asks">> {
  if (input.question.length > 140) fail("NOT_PERMITTED", "Question must be ≤ 140 characters");
  if (input.options.some(option => option.label.length > 32)) fail("NOT_PERMITTED", "Option labels must be ≤ 32 characters");
  const policies = await loadPolicies(ctx, input.ns);
  const route = routeAsk({ need: input.need, amountCents: input.amountAtRiskCents, ctx: input.delegation, policies });
  if (!route.required || !route.role) fail("NOT_PERMITTED", "Within delegation: no ask is needed");
  const kind = KIND_FOR_NEED[input.need];
  const open = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", input.ns).eq("caseId", input.caseId)).collect();
  if (open.some(ask => ask.status === "OPEN" && ask.kind === kind && ask.subject === input.subject)) fail("DUPLICATE", "An open ask already covers this");
  const code = await askCode(ctx, input.ns, input.caseId, open.length + 1);
  const gatesClock = kind === "PAYMENT_APPROVAL" || kind === "COMMERCIAL_DECISION";
  const askId = await ctx.db.insert("asks", {
    ns: input.ns, origin: "AGENT", code, caseId: input.caseId, kind, role: route.role, question: input.question, subject: input.subject,
    options: input.options, context: input.context, gatesClock, status: "OPEN", remindersSent: 0, createdAt: input.createdAt,
    ...(input.amountAtRiskCents !== undefined ? { amountAtRiskCents: input.amountAtRiskCents } : {}),
    ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
  });
  if (kind === "PAYMENT_APPROVAL") {
    const item = await ctx.db.get(input.caseId), statementId = item?.payable ? ctx.db.normalizeId("statements", item.payable.statementId) : null;
    if (statementId) await ctx.scheduler.runAfter(0, internal.node.documents.renderStatement, { statementId, issuedAt: input.createdAt });
  }
  if (kind !== "APPROVE_MEMORY") await ctx.db.patch(input.caseId, { status: "WAITING_HUMAN", updatedAt: input.createdAt });
  await appendAudit(ctx, { ns: input.ns, origin: "AGENT", actor: input.actor, role: input.role, type: "ASK_CREATED", entityType: "ask", entityId: code, correlationId: input.correlationId, after: { kind, role: route.role, question: input.question, policy: route.policyCode }, evidence: input.context.evidence, at: input.createdAt });
  return askId;
}

// ---- internal mutation wrappers (callable from the agent runtime via ctx.runMutation) ----
const actorArgs = { actor: v.string(), role: roleValidator, correlationId: v.string() };
const draftValidator = v.object({
  kind: v.union(...(["ACCRUAL", "ACCRUAL_TRUEUP", "ACCRUAL_REVERSAL", "AP", "AR_RECOVERY", "ADJUSTMENT"] as const).map(kind => v.literal(kind))),
  memo: v.string(),
  lines: v.array(v.object({ account: v.union(...(["1200", "2000", "2150", "5100", "5190"] as const).map(code => v.literal(code))), counterpartyId: v.optional(v.string()), side: v.union(v.literal("DEBIT"), v.literal("CREDIT")), cents: v.number() })),
});
const delegationValidator = v.optional(v.object({ counterpartyStrategic: v.optional(v.boolean()), openDisputeAboveMateriality: v.optional(v.boolean()), currencyMismatch: v.optional(v.boolean()), statementComplete: v.optional(v.boolean()) }));

export const postJournal = internalMutation({
  args: { ns: v.string(), draft: draftValidator, caseId: v.optional(v.id("cases")), postedAt: v.number(), idempotencyKey: v.string(), authority: authorityValidator, evidence: v.array(evidenceRef), delegation: delegationValidator, ...actorArgs },
  returns: v.id("journalEntries"),
  handler: (ctx, args) => postJournalTx(ctx, args),
});

export const fileRecoveryClaim = internalMutation({
  args: { ns: v.string(), caseId: v.id("cases"), counterpartyId: v.id("counterparties"), cents: v.number(), kind: v.union(v.literal("RECOVERY_CLAIM"), v.literal("PROTECTIVE_NOTICE")), authority: authorityValidator, documentId: v.optional(v.id("documents")), filedAt: v.number(), evidence: v.array(evidenceRef), counterpartyStrategic: v.boolean(), ...actorArgs },
  returns: v.id("filings"),
  handler: (ctx, args) => fileRecoveryTx(ctx, args),
});

export const recordDispute = internalMutation({
  args: { ns: v.string(), caseId: v.id("cases"), counterpartyId: v.id("counterparties"), cents: v.number(), authority: authorityValidator, documentId: v.optional(v.id("documents")), filedAt: v.number(), evidence: v.array(evidenceRef), ...actorArgs },
  returns: v.id("filings"),
  handler: (ctx, args) => recordDisputeTx(ctx, args),
});

export const createAsk = internalMutation({
  args: { ns: v.string(), caseId: v.id("cases"), need: v.union(v.literal("FACT"), v.literal("PAYMENT"), v.literal("RECOVERY_FILING"), v.literal("WAIVER"), v.literal("MEMORY")), question: v.string(), subject: v.string(), options: v.array(askOption), context: askContext, amountAtRiskCents: v.optional(v.number()), deadlineAt: v.optional(v.number()), delegation: delegationValidator, createdAt: v.number(), ...actorArgs },
  returns: v.id("asks"),
  handler: (ctx, args) => createAskTx(ctx, args),
});



/** Governance ask: the source persona and candidate memory determine the route, never the model. */
export async function createTeachBackTx(ctx: MutationCtx, memoryId: Id<"memoryItems">) {
  const memory = await ctx.db.get(memoryId);
  if (!memory?.sourceAskId || !memory.sourceCaseId || !memory.sourcePersonaId || memory.status !== "PENDING_TEACHBACK") fail("NOT_PERMITTED", "No source work for teach-back");
  const source = await ctx.db.get(memory.sourceAskId), persona = await ctx.db.get(memory.sourcePersonaId);
  if (!source || !persona || source.caseId !== memory.sourceCaseId || source.answeredBy !== persona._id || !["ops","controller","trader"].includes(persona.role)) fail("NOT_PERMITTED", "Invalid teach-back source");
  const asks = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", memory.ns).eq("caseId", memory.sourceCaseId!)).collect();
  if (asks.some(ask => ask.kind === "TEACH_BACK" && ask.subject === memory.code)) return;
  const b = await ctx.db.get(memory.sourceCaseId), voyage = b ? await ctx.db.get(b.voyageId) : null, port = voyage ? await ctx.db.get(voyage.portId) : null;
  const payload = memory.payload as { type?: string; formCode?: string };
  const procedure = payload.type === "PROCEDURE";
  const formLabel = `All ${payload.formCode ?? "this form"} voyages`;
  const options = procedure ? [{ id: "ALL", label: "All ports" }, { id: "PORT", label: port && `${port.name} only`.length <= 32 ? `${port.name} only` : "This port only" }, { id: "DONT", label: "Don't" }] : [{ id: memory.scope.kind === "COUNTERPARTY" ? "COUNTERPARTY" : "CHARTER_FORM", label: formLabel.length <= 32 ? formLabel : "This charter form" }, { id: "THIS_CASE", label: "Just this case" }, { id: "DONT", label: "Don't" }];
  const code = await askCode(ctx, memory.ns, memory.sourceCaseId, asks.length + 1);
  const at = memory.createdAt;
  await ctx.db.insert("asks", { ns: memory.ns, origin: "AGENT", code, caseId: memory.sourceCaseId, kind: "TEACH_BACK", role: persona.role, question: "Next time?", subject: memory.code, options, context: { evidence: source.answer?.evidence ?? [] }, gatesClock: false, status: "OPEN", remindersSent: 0, createdAt: at });
  await appendAudit(ctx, { ns: memory.ns, origin: "AGENT", actor: "agent:learning", role: "agent", type: "ASK_CREATED", entityType: "ask", entityId: code, correlationId: b?.correlationId ?? `case:${memory.sourceCaseId}`, after: { kind: "TEACH_BACK", role: persona.role, memoryCode: memory.code }, at });
}

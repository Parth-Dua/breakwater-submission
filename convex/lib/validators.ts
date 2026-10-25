import { v } from "convex/values";

// ---- CONTRACTS §2 enums ----------------------------------------------------------------
const literals = <T extends string>(...values: T[]) => v.union(...values.map(value => v.literal(value)));

export const ns = v.string();
export const origin = literals("WORLD_SCRIPT", "HISTORY_IMPORT", "AGENT", "HUMAN", "SYSTEM", "SCRIPTED_RESPONDER", "AUTOMATED_TEST");
export const role = literals("agent", "ops", "controller", "trader", "observer");
export const personaCode = literals("AGENT", "OBSERVER", "OPS", "CONTROLLER", "TRADER");
export const selectablePersonaCode = literals("OBSERVER", "OPS", "CONTROLLER", "TRADER");
export const sourceSystem = literals("MAILBOX", "DOC_STORE", "CONTRACT_REGISTER", "AIS", "PORT_DATA", "CUSTOMS_PORTAL", "LEDGER", "COUNTERPARTY_MASTER", "POLICY_REGISTER");
export const docKind = literals("NOR", "SOF", "OWNER_INVOICE", "PORT_ADVISORY", "PORT_CLOSURE", "CUSTOMS_HOLD", "CUSTOMS_RELEASE", "CHARTER_PARTY", "SALE_CONTRACT", "PURCHASE_CONTRACT", "LAYTIME_STATEMENT", "RECOVERY_CLAIM", "DISPUTE_LETTER", "COUNTERPARTY_REPLY");
export const intervalKind = literals("WAITING", "PORT_CLOSURE", "WEATHER", "SHIFTING", "CUSTOMS_HOLD", "OPERATIONS", "AIS_GAP", "UNKNOWN");
export const treatment = literals("COUNT", "EXCLUDE", "HALF", "UNVERIFIED");
export const side = literals("PAYABLE", "RECOVERABLE");
export const caseStatus = literals("OPEN", "WORKING", "WAITING_HUMAN", "WAITING_EXTERNAL", "NEEDS_REVIEW", "CLOSED");
export const askKind = literals("CONFIRM_FACT", "PAYMENT_APPROVAL", "COMMERCIAL_DECISION", "APPROVE_MEMORY", "TEACH_BACK");
export const askStatus = literals("OPEN", "ANSWERED", "EXPIRED", "CANCELLED");
export const taskKind = literals("FLEET_SCAN", "AIS_UPDATE", "DOCUMENT_RECEIVED", "PORT_NOTICE", "MONTH_END", "DEADLINE_CHECK", "ASK_ANSWERED");
export const taskState = literals("QUEUED", "RUNNING", "SUCCEEDED", "WAITING_HUMAN", "NEEDS_REVIEW", "FAILED");
export const memoryKind = literals("FACT", "PROCEDURE", "PRECEDENT");
export const memoryStatus = literals("PROPOSED", "PENDING_TEACHBACK", "PENDING_CONTROLLER", "ACTIVE", "PRECEDENT_ONLY", "NEEDS_REVIEW", "REJECTED", "REVOKED");
export const diffType = literals("MISSING_SOURCE", "VALUE_CORRECTION", "COMMERCIAL_DECISION", "CONFIRMATION");
export const counterpartyKind = literals("OWNER", "BUYER", "SELLER", "PORT_AGENT");
export const contractKind = literals("CHARTER_PARTY", "SALE", "PURCHASE");
export const operation = literals("LOAD", "DISCHARGE");
export const accountCode = literals("1000", "1200", "2000", "2150", "5100", "5190");
export const journalKind = literals("ACCRUAL", "ACCRUAL_TRUEUP", "ACCRUAL_REVERSAL", "AP", "AR_RECOVERY", "ADJUSTMENT", "SETTLEMENT_IMPORT");
export const policyCode = literals("AP_POSTING", "ACCRUAL", "RECOVERY_FILING", "WAIVER", "MATERIALITY", "DEADLINE_FALLBACK", "PRUDENCE", "MEMORY_APPROVAL");
export const worldEventType = literals("PORT_NOTICE", "AIS_BATCH", "EMAIL", "CLOCK_NOTE", "CUSTOMS_RECORD", "MONTH_END", "PERIOD_LOCK", "DEADLINE");
export const humanEventType = literals("WORK_STARTED", "SOURCE_SEARCHED", "DOCUMENT_OPENED", "EVIDENCE_LINKED", "EVIDENCE_UNLINKED", "LINE_EDITED", "TIMELINE_RANGE_SELECTED", "ANSWER_SUBMITTED", "TEACHBACK_ANSWERED", "MEMORY_DECIDED");
export const factKey = literals("ARRIVAL_IN_PORT_LIMITS", "NOR_TENDERED", "NOR_VALIDITY", "LAYTIME_START_PAYABLE", "LAYTIME_START_RECOVERABLE", "COMPLETION", "INTERVAL");

// ---- CONTRACTS §4 composite types ---------------------------------------------------------
export const evidenceRef = v.union(
  v.object({ kind: v.literal("DOC"), documentId: v.string(), quote: v.optional(v.string()), page: v.optional(v.number()) }),
  v.object({ kind: v.literal("AIS"), vesselId: v.string(), from: v.number(), to: v.number() }),
  v.object({ kind: v.literal("CLAUSE"), contractId: v.string(), clause: v.string() }),
  v.object({ kind: v.literal("MEMORY"), memoryItemId: v.string(), version: v.number() }),
  v.object({ kind: v.literal("ASK"), askId: v.string() }),
  v.object({ kind: v.literal("JOURNAL"), entryId: v.string() }),
);

const treatmentRule = v.object({ treatment, clause: v.string(), requiresEvidence: v.optional(v.array(docKind)) });
export const contractTerms = v.object({
  noticeMinutes: v.number(),
  laytimeMinutes: v.number(),
  deemedNorOnArrival: v.boolean(),
  ratePerHourCents: v.number(),
  treatments: v.object({ PORT_CLOSURE: treatmentRule, WEATHER: treatmentRule, SHIFTING: treatmentRule, CUSTOMS_HOLD: treatmentRule }),
  exceptionsApplyOnDemurrage: v.boolean(),
  timeBar: v.union(v.null(), v.object({ days: v.number(), from: v.literal("COMPLETION"), requires: v.array(docKind) })),
});

export const statementLine = v.object({
  id: v.string(),
  kind: v.union(literals("TIME_ON_LAYTIME", "LAYTIME_ALLOWED", "FEE"), intervalKind),
  startAt: v.optional(v.number()),
  endAt: v.optional(v.number()),
  minutes: v.number(),
  treatment,
  countedMinutes: v.number(),
  clause: v.optional(v.string()),
  evidence: v.array(evidenceRef),
  note: v.string(),
  cents: v.optional(v.number()),
  overriddenBy: v.optional(v.object({ kind: literals("MEMORY", "EDIT"), id: v.string() })),
});
export const statementTotals = v.object({
  countedMinutes: v.number(), laytimeMinutes: v.number(), demurrageMinutes: v.number(),
  demurrageCents: v.number(), feesCents: v.number(), totalCents: v.number(), onDemurrageAt: v.optional(v.number()),
});
export const statementSummary = v.object({ statementId: v.string(), totalCents: v.number(), version: v.number() });
export const editBasis = v.object({ clause: v.optional(v.string()), documentId: v.optional(v.string()), note: v.string() });
export const askOption = v.object({ id: v.string(), label: v.string(), requires: v.optional(v.array(literals("AMOUNT", "REASON", "EVIDENCE", "EDITS"))) });
export const askContext = v.object({ lineIds: v.optional(v.array(v.string())), evidence: v.array(evidenceRef), recommendation: v.optional(v.string()), approvedCents: v.optional(v.number()) });
export const askAnswer = v.object({ optionId: v.string(), amountCents: v.optional(v.number()), reason: v.optional(v.string()), evidence: v.optional(v.array(evidenceRef)), editIds: v.optional(v.array(v.string())), causeKind: v.optional(intervalKind) });
export const authority = v.union(
  v.object({ kind: v.literal("DELEGATION"), policyCode }),
  v.object({ kind: v.literal("APPROVAL"), askId: v.string(), personaId: v.string() }),
  v.object({ kind: v.literal("IMPORTED") }), // history import only (origin HISTORY_IMPORT)
);
export const toolCallLog = v.object({ tool: v.string(), capability: v.optional(v.string()), allowed: v.boolean(), ms: v.number(), summary: v.string() });
export const geoPolygon = v.object({ type: v.literal("Polygon"), coordinates: v.array(v.array(v.array(v.number()))) });
export const memoryScope = v.object({ kind: literals("THIS_CASE", "COUNTERPARTY", "PORT", "CHARTER_FORM", "ALL"), value: v.optional(v.string()) });
export const gateDecision = v.object({ status: memoryStatus, reason: v.string(), requires: v.array(literals("TEACH_BACK", "BACKTEST", "CONTROLLER")) });

// Audit payloads are snapshots of arbitrary typed records; canonical JSON keeps them hashable.
export const auditPayload = v.optional(v.any());
export const auditDetails = v.any();
// Open JSON payloads whose shape is enforced in code (LEARNING §3.1, §4.1; world event payloads).
export const jsonPayload = v.any();

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  accountCode, askAnswer, askContext, askKind, askOption, askStatus, auditDetails, auditPayload, authority, caseStatus,
  contractKind, contractTerms, counterpartyKind, diffType, docKind, editBasis, evidenceRef, factKey, gateDecision,
  geoPolygon, humanEventType, journalKind, jsonPayload, memoryKind, memoryScope, memoryStatus, ns, operation, origin,
  personaCode, policyCode, role, side, sourceSystem, statementLine, statementSummary, statementTotals, taskKind,
  taskState, toolCallLog, worldEventType,
} from "./lib/validators";

// Breakwater v2 schema (docs_v2/CONTRACTS.md §3). Every table has ns + origin (except auth and snapshots).
const base = { ns, origin };

export default defineSchema({
  ...authTables,

  // ---- identity -------------------------------------------------------------------------
  personas: defineTable({ ...base, code: personaCode, displayName: v.string(), role })
    .index("by_code", ["ns", "code"]).index("by_ns", ["ns"]),
  demoSessions: defineTable({ ...base, authUserId: v.id("users"), actingPersonaId: v.id("personas"), updatedAt: v.number() })
    .index("by_auth_user", ["authUserId"]).index("by_ns", ["ns"]),

  // ---- simulation -----------------------------------------------------------------------
  simClock: defineTable({ ...base, simNow: v.number(), status: v.union(v.literal("RUNNING"), v.literal("HELD"), v.literal("IDLE")), holdReason: v.optional(v.string()), pacing: v.union(v.literal("1x"), v.literal("2x")), activeScriptCode: v.optional(v.string()),
    runUntil: v.optional(v.number()), loopToken: v.optional(v.string()), overrideHold: v.optional(v.boolean()), prevSimNow: v.optional(v.number()), changedAtWall: v.optional(v.number()) })
    .index("by_ns", ["ns"]),
  worldScripts: defineTable({ ...base, code: v.string(), anchorAt: v.number(), status: v.union(v.literal("IDLE"), v.literal("ACTIVE"), v.literal("DONE")) })
    .index("by_code", ["ns", "code"]).index("by_ns", ["ns"]),
  worldEvents: defineTable({ ...base, scriptCode: v.string(), seq: v.number(), type: worldEventType, scheduledAt: v.number(), releasedAt: v.optional(v.number()), payload: jsonPayload })
    .index("by_script_seq", ["ns", "scriptCode", "seq"]).index("by_unreleased", ["ns", "releasedAt", "scheduledAt"]).index("by_ns", ["ns"]),

  // ---- company & systems of record --------------------------------------------------------
  counterparties: defineTable({ ...base, code: v.string(), name: v.string(), kind: counterpartyKind, country: v.string(), strategic: v.boolean(), sofTimezoneHabit: v.optional(v.string()) })
    .index("by_code", ["ns", "code"]).index("by_ns", ["ns"]),
  ports: defineTable({ ...base, code: v.string(), name: v.string(), ianaZone: v.string(), anchorage: geoPolygon, anchorageName: v.string(), berth: geoPolygon, berthName: v.string(), customsPortalName: v.string() })
    .index("by_code", ["ns", "code"]).index("by_ns", ["ns"]),
  vessels: defineTable({ ...base, code: v.string(), name: v.string(), imo: v.string(), ownerId: v.id("counterparties") })
    .index("by_code", ["ns", "code"]).index("by_ns", ["ns"]),
  contracts: defineTable({ ...base, code: v.string(), kind: contractKind, formCode: v.string(), counterpartyId: v.id("counterparties"), terms: contractTerms, documentId: v.optional(v.id("documents")) })
    .index("by_code", ["ns", "code"]).index("by_ns", ["ns"]),
  voyages: defineTable({ ...base, code: v.string(), vesselId: v.id("vessels"), portId: v.id("ports"), operation, charterId: v.id("contracts"), cargoContractId: v.id("contracts"), eta: v.number() })
    .index("by_code", ["ns", "code"]).index("by_vessel", ["ns", "vesselId"]).index("by_ns", ["ns"]),
  aisPoints: defineTable({ ...base, voyageId: v.optional(v.id("voyages")), vesselId: v.id("vessels"), at: v.number(), lon: v.number(), lat: v.number(), sogKn: v.number(), cogDeg: v.number() })
    .index("by_vessel_at", ["ns", "vesselId", "at"]).index("by_ns", ["ns"]),
  documents: defineTable({ ...base, voyageId: v.optional(v.id("voyages")), code: v.string(), system: sourceSystem, kind: docKind, vesselId: v.optional(v.id("vessels")), portId: v.optional(v.id("ports")), caseId: v.optional(v.id("cases")), storageId: v.id("_storage"), textLayer: v.string(), title: v.string(), receivedAt: v.optional(v.number()) })
    .index("by_code", ["ns", "code"]).index("by_vessel_kind", ["ns", "vesselId", "kind"]).index("by_case", ["ns", "caseId"]).index("by_ns", ["ns"]),
  mailMessages: defineTable({ ...base, documentId: v.optional(v.id("documents")), from: v.string(), subject: v.string(), receivedAt: v.number(), vesselImo: v.optional(v.string()), bodyText: v.string() })
    .index("by_received", ["ns", "receivedAt"]).index("by_ns", ["ns"]),
  customsRecords: defineTable({ ...base, portId: v.id("ports"), vesselId: v.id("vessels"), kind: v.union(v.literal("HOLD"), v.literal("RELEASE")), startAt: v.number(), endAt: v.optional(v.number()), documentId: v.id("documents") })
    .index("by_port_vessel", ["ns", "portId", "vesselId"]).index("by_ns", ["ns"]),

  // ---- system of work: cases ----------------------------------------------------------------
  cases: defineTable({ ...base, code: v.string(), voyageId: v.id("voyages"), status: caseStatus, openedAt: v.number(), closedAt: v.optional(v.number()), statusLine: v.string(), payable: v.optional(statementSummary), recoverable: v.optional(statementSummary), billedCents: v.optional(v.number()), disputedCents: v.optional(v.number()), timeBarAt: v.optional(v.number()), correlationId: v.string(), updatedAt: v.number(),
    reconciliation: v.optional(jsonPayload), invoiceDocumentId: v.optional(v.id("documents")) })
    .index("by_code", ["ns", "code"]).index("by_status", ["ns", "status"]).index("by_voyage", ["ns", "voyageId"]).index("by_ns", ["ns"]),
  facts: defineTable({ ...base, caseId: v.id("cases"), key: factKey, value: jsonPayload, evidence: v.array(evidenceRef), establishedBy: v.union(v.literal("AGENT"), v.literal("HUMAN")), at: v.number(), supersededBy: v.optional(v.id("facts")) })
    .index("by_case_key", ["ns", "caseId", "key"]).index("by_ns", ["ns"]),
  statements: defineTable({ ...base, caseId: v.id("cases"), side, version: v.number(), contractId: v.id("contracts"), laytimeStartAt: v.number(), completionAt: v.number(), lines: v.array(statementLine), totals: statementTotals, computedAt: v.number(), memoryItemIds: v.array(v.string()) })
    .index("by_case_side_version", ["ns", "caseId", "side", "version"]).index("by_ns", ["ns"]),
  statementEdits: defineTable({ ...base, statementId: v.id("statements"), lineId: v.string(), field: v.literal("treatment"), from: v.string(), to: v.string(), basis: editBasis, personaId: v.optional(v.id("personas")), at: v.number(), status: v.union(v.literal("DRAFT"), v.literal("APPLIED"), v.literal("DISCARDED")) })
    .index("by_statement", ["ns", "statementId"]).index("by_ns", ["ns"]),

  extractions: defineTable({ ...base, documentId: v.id("documents"), kind: docKind, fields: jsonPayload, rejected: v.array(v.string()), model: v.string(), extractedAt: v.number() })
    .index("by_document", ["ns", "documentId"]).index("by_ns", ["ns"]),

  // ---- agent runtime ------------------------------------------------------------------------
  agentTasks: defineTable({ ...base, caseId: v.optional(v.id("cases")), kind: taskKind, triggerEventId: v.optional(v.id("worldEvents")), triggerAskId: v.optional(v.id("asks")), state: taskState, attempt: v.number(), leaseToken: v.optional(v.string()), leaseUntil: v.optional(v.number()), idempotencyKey: v.string(), model: v.optional(v.string()), tokensIn: v.optional(v.number()), tokensOut: v.optional(v.number()), cacheRead: v.optional(v.number()), cacheWrite: v.optional(v.number()), error: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number() })
    .index("by_idempotency", ["ns", "idempotencyKey"]).index("by_state", ["ns", "state"]).index("by_case", ["ns", "caseId"]).index("by_ns", ["ns"]),
  agentSteps: defineTable({ ...base, taskId: v.id("agentTasks"), caseId: v.optional(v.id("cases")), seq: v.number(), status: v.union(v.literal("RUNNING"), v.literal("DONE"), v.literal("ASKED"), v.literal("FAILED")), title: v.string(), observation: v.optional(v.string()), check: v.optional(v.string()), conclusion: v.optional(v.string()), evidence: v.array(evidenceRef), memoryRefs: v.array(v.string()), deltaCents: v.optional(v.number()), toolCalls: v.array(toolCallLog), simAt: v.number(), wallAt: v.number() })
    .index("by_case_seq", ["ns", "caseId", "seq"]).index("by_task", ["ns", "taskId"]).index("by_ns", ["ns"]),
  asks: defineTable({ ...base, code: v.string(), caseId: v.id("cases"), kind: askKind, role, question: v.string(), subject: v.string(), options: v.array(askOption), context: askContext, amountAtRiskCents: v.optional(v.number()), deadlineAt: v.optional(v.number()), gatesClock: v.boolean(), status: askStatus, answer: v.optional(askAnswer), answeredBy: v.optional(v.id("personas")), answeredAt: v.optional(v.number()), remindersSent: v.number(), createdAt: v.number() })
    .index("by_code", ["ns", "code"]).index("by_case", ["ns", "caseId"]).index("by_role_status", ["ns", "role", "status"]).index("by_ns", ["ns"]),
  humanEvents: defineTable({ ...base, askId: v.id("asks"), caseId: v.id("cases"), personaId: v.id("personas"), role, type: humanEventType, payload: jsonPayload, simAt: v.number(), wallAt: v.number(), seq: v.number() })
    .index("by_ask_seq", ["ns", "askId", "seq"]).index("by_ns", ["ns"]),

  // ---- learning & memory ----------------------------------------------------------------------
  learningRuns: defineTable({ ...base, askId: v.id("asks"), state: v.union(v.literal("RUNNING"), v.literal("COMPLETE"), v.literal("NEEDS_REVIEW")), leaseToken: v.string(), leaseUntil: v.number(), error: v.optional(v.string()), updatedAt: v.number() }).index("by_ask", ["ns", "askId"]).index("by_ns", ["ns"]),
  traceDiffs: defineTable({ ...base, askId: v.id("asks"), caseId: v.id("cases"), type: diffType, agentSide: jsonPayload, humanSide: jsonPayload, provenanceEventIds: v.array(v.id("humanEvents")), ignoredEventIds: v.array(v.id("humanEvents")) })
    .index("by_ask", ["ns", "askId"]).index("by_ns", ["ns"]),
  lessons: defineTable({ ...base, traceDiffId: v.id("traceDiffs"), lessonJson: jsonPayload, payload: jsonPayload, lessonText: v.string(), draftModel: v.optional(v.string()), draftUsage: v.optional(jsonPayload) })
    .index("by_diff", ["ns", "traceDiffId"]).index("by_ns", ["ns"]),
  classifierCalls: defineTable({ ...base, lessonId: v.id("lessons"), provider: v.literal("jev"), model: v.string(), request: jsonPayload, response: v.optional(jsonPayload), status: v.union(v.literal("OK"), v.literal("ERROR")), error: v.optional(v.string()), latencyMs: v.number() })
    .index("by_lesson", ["ns", "lessonId"]).index("by_ns", ["ns"]),
  memoryItems: defineTable({ ...base, code: v.string(), kind: memoryKind, status: memoryStatus, title: v.string(), payload: jsonPayload, scope: memoryScope, sourceCaseId: v.optional(v.id("cases")), sourceAskId: v.optional(v.id("asks")), sourcePersonaId: v.optional(v.id("personas")), lessonId: v.optional(v.id("lessons")), gateDecision: v.optional(gateDecision), approvedBy: v.optional(v.id("personas")), approvedAt: v.optional(v.number()), backtestId: v.optional(v.id("backtests")), version: v.number(), usedIn: v.array(v.id("cases")), createdAt: v.number(), newAtWall: v.optional(v.number()) })
    .index("by_code", ["ns", "code"]).index("by_status", ["ns", "status"]).index("by_ns", ["ns"]),
  backtests: defineTable({ ...base, memoryItemId: v.id("memoryItems"), cases: jsonPayload, consistent: v.number(), total: v.number(), ranAt: v.number() })
    .index("by_memory", ["ns", "memoryItemId"]).index("by_ns", ["ns"]),

  // ---- books ----------------------------------------------------------------------------------
  periods: defineTable({ ...base, code: v.string(), startAt: v.number(), endAt: v.number(), status: v.union(v.literal("OPEN"), v.literal("LOCKED")), lockAt: v.optional(v.number()) })
    .index("by_code", ["ns", "code"]).index("by_ns", ["ns"]),
  journalEntries: defineTable({ ...base, code: v.string(), caseId: v.optional(v.id("cases")), periodCode: v.string(), kind: journalKind, idempotencyKey: v.string(), authority, evidence: v.array(evidenceRef), memo: v.string(), postedAt: v.number(), postedWallAt: v.number() })
    .index("by_idempotency", ["ns", "idempotencyKey"]).index("by_case", ["ns", "caseId"]).index("by_period", ["ns", "periodCode"]).index("by_ns", ["ns"]),
  journalLines: defineTable({ ...base, entryId: v.id("journalEntries"), account: accountCode, counterpartyId: v.optional(v.id("counterparties")), side: v.union(v.literal("DEBIT"), v.literal("CREDIT")), cents: v.number() })
    .index("by_entry", ["ns", "entryId"]).index("by_account", ["ns", "account"]).index("by_ns", ["ns"]),
  filings: defineTable({ ...base, caseId: v.id("cases"), kind: v.union(v.literal("RECOVERY_CLAIM"), v.literal("PROTECTIVE_NOTICE"), v.literal("DISPUTE")), counterpartyId: v.id("counterparties"), cents: v.number(), documentId: v.optional(v.id("documents")), filedAt: v.number(), authority })
    .index("by_case", ["ns", "caseId"]).index("by_ns", ["ns"]),
  policies: defineTable({ ...base, code: policyCode, params: jsonPayload, effectiveAt: v.number(), status: v.union(v.literal("ACTIVE"), v.literal("RETIRED")) })
    .index("by_code", ["ns", "code"]).index("by_ns", ["ns"]),

  // ---- audit & proof --------------------------------------------------------------------------
  auditEvents: defineTable({
    ...base,
    seq: v.number(), prevHash: v.string(), hash: v.string(), at: v.number(), wallAt: v.number(),
    actor: v.string(), role, type: v.string(), entityType: v.string(), entityId: v.string(), correlationId: v.string(),
    before: auditPayload, after: auditPayload, evidence: v.optional(v.array(evidenceRef)), details: auditDetails,
  }).index("by_ns_seq", ["ns", "seq"]).index("by_entity", ["entityId"]).index("by_correlation", ["correlationId"]).index("by_ns", ["ns"]),
  explanations: defineTable({ ...base, entityId: v.string(), field: v.string(), entityVersion: v.number(), text: v.string(), citations: v.array(evidenceRef), model: v.string(), usage: v.optional(jsonPayload) })
    .index("by_entity_field", ["ns", "entityId", "field"]).index("by_ns", ["ns"]),
  scoreRuns: defineTable({ ...base, ranAt: v.number(), model: v.string(), voyages: v.number(), metrics: jsonPayload, perVoyage: jsonPayload })
    .index("by_ran", ["ns", "ranAt"]).index("by_ns", ["ns"]),
  calibrationRuns: defineTable({ ...base, provider: v.literal("jev"), model: v.string(), ranAt: v.number(), total: v.number(), correct: v.number(), perItem: jsonPayload })
    .index("by_ran", ["ns", "ranAt"]).index("by_ns", ["ns"]),
  baselineSnapshots: defineTable({ ns, label: v.string(), storageId: v.id("_storage"), rowCounts: jsonPayload, simNow: v.number(), createdAt: v.number() })
    .index("by_label", ["ns", "label"]),
});

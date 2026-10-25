import type { SourceSystem } from "./capabilities";
import type { EvidenceRef } from "./laytime";
import type { ExceptionKind, Treatment } from "../world/types";

export type Procedure = { dslVersion: 2; trigger: { intervalKind: "CUSTOMS_HOLD"; missingEvidence: "CUSTOMS_RELEASE"; ports: "ALL" | string[] }; grants: { system: "CUSTOMS_PORTAL"; scope: "CASE_VESSEL_AND_INTERVAL" }[]; steps: ProcedureStep[] };
export type ProcedureStep = { op: "SEARCH_SOURCE"; system: SourceSystem; match: { vessel: true; interval: true } } | { op: "VERIFY_DOCUMENT"; checks: ("SAME_VESSEL" | "COVERS_INTERVAL" | "ISSUER_IS_AUTHORITY")[] } | { op: "LINK_EVIDENCE"; target: "TRIGGER_INTERVAL" } | { op: "MARK_VERIFIED" } | { op: "ESCALATE_IF_MISSING"; role: "ops" };
export type MemoryPayload =
  | { type: "CONTRACT_RULE_OVERRIDE"; formCode: string; clause: string; rule: "EXCEPTIONS_APPLY_ON_DEMURRAGE"; value: boolean }
  | { type: "CONTRACT_RULE_OVERRIDE"; formCode: string; clause: string; rule: "TREATMENT"; intervalKind: ExceptionKind; value: Treatment }
  | { type: "COUNTERPARTY_FACT"; counterpartyCode: string; key: "SOF_TIMEZONE" | "INVOICE_INCLUDES_SHIFTING"; value: string }
  | { type: "PROCEDURE"; procedure: Procedure }
  | { type: "PRECEDENT"; summary: string; counterpartyCode?: string; amountCents?: number };
export type TraceOp = { op: "SEARCH" | "READ" | "COMPUTE" | "ASK" | "POST"; system?: SourceSystem; subject?: string };
export type HumanEvent = { id: string; seq: number; type: string; origin: string; payload: Record<string, unknown> };
export type DiffType = "MISSING_SOURCE" | "VALUE_CORRECTION" | "COMMERCIAL_DECISION" | "CONFIRMATION";
export type TraceDiff = { type: DiffType; agentSide: Record<string, unknown>; humanSide: Record<string, unknown>; provenanceEventIds: string[]; ignoredEventIds: string[]; humanEvidence: boolean };
export type AskInput = { kind: string; role: string; subject: string; amountAtRiskCents?: number; answer?: { optionId: string; evidence?: EvidenceRef[]; editIds?: string[]; amountCents?: number; reason?: string } };
export type LessonJson = { lesson_text: string; diff_type: DiffType; source: { role: string; action: string; case: string }; agent_did: string; human_did: string; human_basis: { clause?: string; note?: string }; references: { contract_clause: boolean; contract_form: string; counterparty_specific: boolean; amount_specific: boolean; port_specific: boolean; relationship_language: boolean }; financial_impact: boolean; grants_access: boolean; history: { corroborating: number; contradicting: number }; proposed_payload: MemoryPayload };
export type KindChoice = "FACT" | "PROCEDURE" | "PRECEDENT" | "POLICY_CHANGE";
export type ScopeChoice = "THIS_CASE" | "COUNTERPARTY" | "PORT" | "CHARTER_FORM" | "ALL";
export type ClassifierResult = { kind: { choice: KindChoice; probabilities: Record<string, number>; confidence: number }; scope: { choice: ScopeChoice; probabilities: Record<string, number>; confidence: number }; discretionary: { noul: number }; provider: "jev"; model: string; requestId?: string };
export type MemoryStatus = "PROPOSED" | "PENDING_TEACHBACK" | "PENDING_CONTROLLER" | "ACTIVE" | "PRECEDENT_ONLY" | "NEEDS_REVIEW" | "REJECTED" | "REVOKED";
export type GateDecision = { status: MemoryStatus; reason: string; requires: ("TEACH_BACK" | "BACKTEST" | "CONTROLLER")[] };
export type ProcedureContext = { portCode: string; vesselId: string; interval: { from: number; to: number } | null; missingEvidence: boolean };
export type ProcedureRecord = { kind: "HOLD" | "RELEASE"; vesselId: string; from: number; to?: number; documentCode: string; authority: boolean };
export type HistoricalCase = { caseCode: string; formCode: string; portCode: string; vesselId: string; holds: { from: number; to: number; resolution: "VERIFIED" | "ESCALATED" | "REJECTED" }[]; records: ProcedureRecord[]; edits: { lineKind: string; from: string; to: string; clause?: string; note: string }[] };

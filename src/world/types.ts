// Shared world types (docs_v2/WORLD.md, CONTRACTS §4). Pure data, no I/O.

export type IntervalKind = "WAITING" | "PORT_CLOSURE" | "WEATHER" | "SHIFTING" | "CUSTOMS_HOLD" | "OPERATIONS" | "AIS_GAP" | "UNKNOWN";
export type Treatment = "COUNT" | "EXCLUDE" | "HALF" | "UNVERIFIED";
export type DocKind = "NOR" | "SOF" | "OWNER_INVOICE" | "PORT_ADVISORY" | "PORT_CLOSURE" | "CUSTOMS_HOLD" | "CUSTOMS_RELEASE"
  | "CHARTER_PARTY" | "SALE_CONTRACT" | "PURCHASE_CONTRACT" | "LAYTIME_STATEMENT" | "RECOVERY_CLAIM" | "DISPUTE_LETTER" | "COUNTERPARTY_REPLY";
export type ExceptionKind = "PORT_CLOSURE" | "WEATHER" | "SHIFTING" | "CUSTOMS_HOLD";

export type TreatmentRule = { treatment: Treatment; clause: string; requiresEvidence?: DocKind[] };
export type ContractTerms = {
  noticeMinutes: number;
  laytimeMinutes: number;
  deemedNorOnArrival: boolean;
  ratePerHourCents: number;
  treatments: Record<ExceptionKind, TreatmentRule>;
  exceptionsApplyOnDemurrage: boolean;
  timeBar: { days: number; from: "COMPLETION"; requires: DocKind[] } | null;
};

export type Polygon = { type: "Polygon"; coordinates: number[][][] };
export type CounterpartyKind = "OWNER" | "BUYER" | "SELLER" | "PORT_AGENT";
export type CounterpartyDef = { code: string; name: string; kind: CounterpartyKind; country: string; strategic: boolean; sofTimezoneHabit?: string };
export type PortDef = { code: string; name: string; ianaZone: string; anchorage: Polygon; anchorageName: string; berth: Polygon; berthName: string; customsPortalName: string };
export type VesselDef = { code: string; name: string; imo: string; ownerCode: string };
export type ContractKind = "CHARTER_PARTY" | "SALE" | "PURCHASE";
export type ContractDef = { code: string; kind: ContractKind; formCode: string; counterpartyCode: string; terms: ContractTerms; documentCode: string };
export type VoyageDef = { code: string; vesselCode: string; portCode: string; operation: "LOAD" | "DISCHARGE"; charterCode: string; cargoContractCode: string; eta: number };

export type AisPoint = { at: number; lon: number; lat: number; sogKn: number; cogDeg: number };
export type SofRow = { localText: string; fold?: 0 | 1; entry: string };
export type IntervalTruth = { kind: IntervalKind; startAt: number; endAt: number; verified: boolean };

export type StatementLineTruth = { kind: string; startAt?: number; endAt?: number; minutes: number; treatment: Treatment; countedMinutes: number; clause?: string };
export type StatementTruth = {
  laytimeStartAt: number; completionAt: number; lines: StatementLineTruth[];
  countedMinutes: number; laytimeMinutes: number; demurrageMinutes: number; demurrageCents: number;
  feesCents: number; totalCents: number; onDemurrageAt?: number;
};

export type AccountCode = "1000" | "1200" | "2000" | "2150" | "5100" | "5190";
export type JournalKind = "ACCRUAL" | "ACCRUAL_TRUEUP" | "ACCRUAL_REVERSAL" | "AP" | "AR_RECOVERY" | "ADJUSTMENT" | "SETTLEMENT_IMPORT";
export type JournalLineDef = { account: AccountCode; counterpartyCode?: string; side: "DEBIT" | "CREDIT"; cents: number };
export type JournalDef = { code: string; caseCode?: string; periodCode: string; kind: JournalKind; postedAt: number; memo: string; lines: JournalLineDef[] };

export type PolicyCode = "AP_POSTING" | "ACCRUAL" | "RECOVERY_FILING" | "WAIVER" | "MATERIALITY" | "DEADLINE_FALLBACK" | "PRUDENCE" | "MEMORY_APPROVAL";
export type PolicyDef = { code: PolicyCode; params: Record<string, unknown> };
export type PeriodDef = { code: string; startAt: number; endAt: number; status: "OPEN" | "LOCKED"; lockAt?: number };

export type DocumentSpec = { code: string; kind: DocKind; system: "MAILBOX" | "DOC_STORE" | "CUSTOMS_PORTAL"; title: string; vesselCode?: string; portCode?: string; receivedAt?: number; template: string; data: Record<string, unknown> };
export type CustomsRecordDef = { portCode: string; vesselCode: string; kind: "HOLD" | "RELEASE"; startAt: number; endAt?: number; documentCode: string };

export type PatternTag =
  | "CUSTOMS_RELEASE_IN_PORTAL" | "CUSTOMS_RELEASE_OUTSIDE_INTERVAL" | "CUSTOMS_NO_RELEASE"
  | "NORDHAVN_CLOSURE_AFTER_DEMURRAGE_COUNTED" | "PREMATURE_NOR" | "SOF_LOCAL_AS_UTC" | "SHIFTING_BILLED" | "GOODWILL_WAIVER";

export type HistoryCase = {
  caseCode: string;
  voyage: VoyageDef;
  ais: AisPoint[];
  arrivalAt: number;
  nor: { tenderedAt: number; position: [number, number] };
  completionAt: number;
  intervals: IntervalTruth[];
  sof: { ianaZone: string; rows: SofRow[] };
  ownerInvoice: { invoiceNo: string; receivedAt: number; lines: { label: string; minutes?: number; cents: number }[]; totalCents: number; laytimeStartText: string; completionText: string; currency: "USD" | "EUR"; duplicateOf?: string };
  truth: { payable: StatementTruth; recoverable: StatementTruth };
  outcome: { approvedPayableCents: number; disputedCents: number; recoveredCents: number; waiverCents: number; waiverReason?: string; customsResolution?: "VERIFIED" | "ESCALATED" | "REJECTED"; sourceUsed?: "CUSTOMS_PORTAL" | "MAILBOX" };
  edits: { lineKind: string; from: Treatment; to: Treatment; clause: string; note: string }[];
  customs: CustomsRecordDef[];
  documents: DocumentSpec[];
  journals: JournalDef[];
  patterns: PatternTag[];
  openedAt: number;
  closedAt: number;
};

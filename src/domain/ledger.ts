// CONTRACTS §5, §7 ledger.ts — chart of accounts, journal builders, validation. Pure.
import { assertCents } from "./money";

export type AccountCode = "1000" | "1200" | "2000" | "2150" | "5100" | "5190";
export type JournalKind = "ACCRUAL" | "ACCRUAL_TRUEUP" | "ACCRUAL_REVERSAL" | "AP" | "AR_RECOVERY" | "ADJUSTMENT" | "SETTLEMENT_IMPORT";
export type JournalLineDraft = { account: AccountCode; counterpartyId?: string; side: "DEBIT" | "CREDIT"; cents: number };
export type JournalDraft = { kind: JournalKind; memo: string; lines: JournalLineDraft[] };
/** What the agent/gateway may post: never the bank account, never imported settlements. */
export type AgentJournalDraft = { kind: Exclude<JournalKind, "SETTLEMENT_IMPORT">; memo: string; lines: (JournalLineDraft & { account: Exclude<AccountCode, "1000"> })[] };
export type Period = { code: string; startAt: number; endAt: number; status: "OPEN" | "LOCKED" };
export type LedgerError = "UNBALANCED" | "PERIOD_LOCKED" | "OUT_OF_PERIOD" | "INVALID_AMOUNT" | "INVALID_ACCOUNT" | "EMPTY" | "IMPORT_ONLY";

export const accountsCatalog: Record<AccountCode, { name: string; normal: "DEBIT" | "CREDIT"; agentPostable: boolean }> = {
  "1000": { name: "Bank (imported settlements only)", normal: "DEBIT", agentPostable: false },
  "1200": { name: "Accounts receivable, demurrage recoveries", normal: "DEBIT", agentPostable: true },
  "2000": { name: "Accounts payable, owners", normal: "CREDIT", agentPostable: true },
  "2150": { name: "Accrued demurrage payable", normal: "CREDIT", agentPostable: true },
  "5100": { name: "Demurrage expense", normal: "DEBIT", agentPostable: true },
  "5190": { name: "Demurrage recovered", normal: "CREDIT", agentPostable: true },
};

/** Month-end accrual or true-up to the current payable estimate. Null when nothing changes. */
export function buildAccrual(caseCode: string, estimateCents: number, alreadyAccruedCents: number): AgentJournalDraft | null {
  assertCents(estimateCents); assertCents(alreadyAccruedCents);
  const delta = estimateCents - alreadyAccruedCents;
  if (delta === 0) return null;
  const kind = alreadyAccruedCents === 0 ? "ACCRUAL" as const : "ACCRUAL_TRUEUP" as const;
  const lines: AgentJournalDraft["lines"] = delta > 0
    ? [{ account: "5100", side: "DEBIT", cents: delta }, { account: "2150", side: "CREDIT", cents: delta }]
    : [{ account: "2150", side: "DEBIT", cents: -delta }, { account: "5100", side: "CREDIT", cents: -delta }];
  return { kind, memo: `${kind === "ACCRUAL" ? "Demurrage accrual" : "Accrual true-up"} · ${caseCode}`, lines };
}

/** On invoice approval: reverse the accrual, then recognize the approved payable in AP. */
export function buildReversalAndAp(caseCode: string, accruedCents: number, approvedPayableCents: number, ownerId: string): AgentJournalDraft[] {
  assertCents(accruedCents); assertCents(approvedPayableCents);
  const drafts: AgentJournalDraft[] = [];
  if (accruedCents > 0) drafts.push({ kind: "ACCRUAL_REVERSAL", memo: `Reverse accrual · ${caseCode}`, lines: [{ account: "2150", side: "DEBIT", cents: accruedCents }, { account: "5100", side: "CREDIT", cents: accruedCents }] });
  if (approvedPayableCents > 0) drafts.push({ kind: "AP", memo: `Approved demurrage · ${caseCode}`, lines: [{ account: "5100", side: "DEBIT", cents: approvedPayableCents }, { account: "2000", counterpartyId: ownerId, side: "CREDIT", cents: approvedPayableCents }] });
  return drafts;
}

/** Recoverable recognized when filed (PRUDENCE). */
export function buildRecovery(caseCode: string, filedCents: number, counterpartyId: string): AgentJournalDraft {
  assertCents(filedCents);
  return { kind: "AR_RECOVERY", memo: `Demurrage claim filed · ${caseCode}`, lines: [{ account: "1200", counterpartyId, side: "DEBIT", cents: filedCents }, { account: "5190", side: "CREDIT", cents: filedCents }] };
}

export function validateJournal(draft: JournalDraft, period: Period, postedAt: number): { ok: true } | { ok: false; code: LedgerError } {
  if (!draft.lines.length) return { ok: false, code: "EMPTY" };
  for (const line of draft.lines) {
    if (!Number.isSafeInteger(line.cents) || line.cents <= 0) return { ok: false, code: "INVALID_AMOUNT" };
    const account = accountsCatalog[line.account];
    if (!account) return { ok: false, code: "INVALID_ACCOUNT" };
    if (!account.agentPostable || draft.kind === "SETTLEMENT_IMPORT") return { ok: false, code: "IMPORT_ONLY" };
  }
  const debit = draft.lines.filter(line => line.side === "DEBIT").reduce((sum, line) => sum + line.cents, 0);
  const credit = draft.lines.filter(line => line.side === "CREDIT").reduce((sum, line) => sum + line.cents, 0);
  if (debit !== credit) return { ok: false, code: "UNBALANCED" };
  if (postedAt < period.startAt || postedAt >= period.endAt) return { ok: false, code: "OUT_OF_PERIOD" };
  if (period.status !== "OPEN") return { ok: false, code: "PERIOD_LOCKED" };
  return { ok: true };
}

export function draftTotal(draft: JournalDraft): number {
  return draft.lines.filter(line => line.side === "DEBIT").reduce((sum, line) => sum + line.cents, 0);
}

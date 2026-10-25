// CONTRACTS §5 laytime.ts — the laytime engine (interval arithmetic). Pure; independent of src/world/truth.ts.
// Rules: intervals must not overlap; HALF counts floor(minutes/2); the vessel is "on demurrage" from the instant counted
// time reaches laytime; if exceptions do not apply on demurrage, PORT_CLOSURE/WEATHER after that instant COUNT;
// UNVERIFIED intervals are excluded; demurrage is rounded once (minutes × rate/hour ÷ 60, half-up).
import { proRataCents } from "./money";
import type { ContractTerms, ExceptionKind, IntervalKind, Treatment } from "../world/types";

const MINUTE = 60_000;
const EXCEPTIONS: ExceptionKind[] = ["PORT_CLOSURE", "WEATHER", "SHIFTING", "CUSTOMS_HOLD"];

export type EvidenceRef =
  | { kind: "DOC"; documentId: string; quote?: string; page?: number }
  | { kind: "AIS"; vesselId: string; from: number; to: number }
  | { kind: "CLAUSE"; contractId: string; clause: string }
  | { kind: "MEMORY"; memoryItemId: string; version: number }
  | { kind: "ASK"; askId: string }
  | { kind: "JOURNAL"; entryId: string };

export type StatementLine = {
  id: string;
  kind: "TIME_ON_LAYTIME" | "LAYTIME_ALLOWED" | "FEE" | IntervalKind;
  startAt?: number; endAt?: number; minutes: number;
  treatment: Treatment; countedMinutes: number;
  clause?: string; evidence: EvidenceRef[]; note: string; cents?: number;
  overriddenBy?: { kind: "MEMORY" | "EDIT"; id: string };
};
export type StatementTotals = { countedMinutes: number; laytimeMinutes: number; demurrageMinutes: number; demurrageCents: number; feesCents: number; totalCents: number; onDemurrageAt?: number };

export type ContractRuleOverride =
  | { memoryItemId: string; version: number; formCode: string; clause: string; rule: "EXCEPTIONS_APPLY_ON_DEMURRAGE"; value: boolean }
  | { memoryItemId: string; version: number; formCode: string; clause: string; rule: "TREATMENT"; intervalKind: ExceptionKind; value: Treatment };
export type StatementEditInput = { editId: string; lineId: string; treatment: Treatment };
export type IntervalInput = { kind: IntervalKind; startAt: number; endAt: number; verified: boolean; evidence: EvidenceRef[] };

export type ComputeInput = {
  side: "PAYABLE" | "RECOVERABLE"; terms: ContractTerms; formCode?: string; contractId?: string;
  laytimeStartAt: number; completionAt: number;
  intervals: IntervalInput[];
  fees: { label: string; cents: number; evidence: EvidenceRef[] }[];
  overrides: ContractRuleOverride[];
  edits: StatementEditInput[];
};

export const lineId = (kind: string, startAt: number | undefined) => `${kind}:${startAt ?? 0}`;

function applyOverrides(terms: ContractTerms, overrides: ContractRuleOverride[], formCode?: string): ContractTerms {
  let next: ContractTerms = terms;
  for (const override of overrides) {
    if (override.formCode !== formCode) continue;
    if (override.rule === "EXCEPTIONS_APPLY_ON_DEMURRAGE") next = { ...next, exceptionsApplyOnDemurrage: override.value };
    else next = { ...next, treatments: { ...next.treatments, [override.intervalKind]: { ...next.treatments[override.intervalKind], treatment: override.value } } };
  }
  return next;
}

const weigh = (treatment: Treatment, minutes: number) => treatment === "COUNT" ? minutes : treatment === "HALF" ? Math.floor(minutes / 2) : 0;

function noteFor(kind: ExceptionKind, treatment: Treatment, clause: string, onDemurrageFull: boolean, edited: boolean): string {
  const subject: Record<ExceptionKind, string> = { PORT_CLOSURE: "Port closed", WEATHER: "Weather stoppage", SHIFTING: "Shifting to berth", CUSTOMS_HOLD: "Customs hold" };
  if (treatment === "UNVERIFIED") return `${subject[kind]} unverified; excluded`;
  if (onDemurrageFull) return `${subject[kind]}; counts in full, already on demurrage (cl. ${clause})`;
  const verb = treatment === "COUNT" ? "counts" : treatment === "HALF" ? "counts at half" : "excluded";
  return `${subject[kind]}${kind === "CUSTOMS_HOLD" ? " verified" : ""}; ${verb} (cl. ${clause})${edited ? " · edited" : ""}`;
}

type Core = { lines: StatementLine[]; totals: StatementTotals };

function compute(input: ComputeInput, terms: ContractTerms): Core {
  const { laytimeStartAt, completionAt, contractId } = input;
  if (!(completionAt > laytimeStartAt)) throw new Error("completion must follow laytime start");
  const exceptions = input.intervals
    .filter(interval => (EXCEPTIONS as string[]).includes(interval.kind))
    .map(interval => ({ ...interval, kind: interval.kind as ExceptionKind, startAt: Math.max(interval.startAt, laytimeStartAt), endAt: Math.min(interval.endAt, completionAt) }))
    .filter(interval => interval.endAt > interval.startAt)
    .sort((a, b) => a.startAt - b.startAt);
  for (let index = 1; index < exceptions.length; index++) if (exceptions[index].startAt < exceptions[index - 1].endAt) throw new Error("Intervals overlap");
  const editFor = new Map(input.edits.map(edit => [edit.lineId, edit]));
  const laytime = terms.laytimeMinutes;
  const totalMinutes = (completionAt - laytimeStartAt) / MINUTE;
  let counted = 0, cursor = laytimeStartAt;
  let onDemurrageAt: number | undefined;
  const plain = (until: number) => {
    const minutes = (until - cursor) / MINUTE;
    if (onDemurrageAt === undefined && counted + minutes >= laytime && minutes > 0) onDemurrageAt = cursor + Math.max(0, laytime - counted) * MINUTE;
    counted += minutes; cursor = until;
  };
  const clauseRef = (clause: string): EvidenceRef[] => (contractId ? [{ kind: "CLAUSE", contractId, clause }] : []);
  const lines: StatementLine[] = [{ id: lineId("TIME_ON_LAYTIME", laytimeStartAt), kind: "TIME_ON_LAYTIME", startAt: laytimeStartAt, endAt: completionAt, minutes: totalMinutes, treatment: "COUNT", countedMinutes: totalMinutes, evidence: [], note: "Time from laytime start to completion" }];
  for (const interval of exceptions) {
    plain(interval.startAt);
    const rule = terms.treatments[interval.kind];
    const id = lineId(interval.kind, interval.startAt);
    const edit = editFor.get(id);
    const minutes = (interval.endAt - interval.startAt) / MINUTE;
    // Evidence is needed to claim an exception or where the clause requires a record; time that counts anyway needs none.
    const needsProof = rule.treatment !== "COUNT" || Boolean(rule.requiresEvidence?.length);
    let treatment: Treatment = edit ? edit.treatment : interval.verified || !needsProof ? rule.treatment : "UNVERIFIED";
    let countedHere: number;
    let fullOnDemurrage = false;
    const proviso = !edit && interval.verified && !terms.exceptionsApplyOnDemurrage && (interval.kind === "PORT_CLOSURE" || interval.kind === "WEATHER") && treatment !== "COUNT";
    if (proviso && onDemurrageAt !== undefined && onDemurrageAt <= interval.startAt) {
      treatment = "COUNT"; countedHere = minutes; fullOnDemurrage = true;
    } else {
      countedHere = weigh(treatment, minutes);
      if (proviso && treatment === "HALF" && counted + countedHere > laytime) {
        // Laytime expires inside the interval: the part before expiry at half, the remainder in full.
        const needed = laytime - counted;
        const before = needed * 2;
        onDemurrageAt = interval.startAt + before * MINUTE;
        countedHere = needed + (minutes - before);
      }
    }
    if (onDemurrageAt === undefined && counted + countedHere >= laytime && countedHere > 0) {
      onDemurrageAt = treatment === "COUNT" ? interval.startAt + (laytime - counted) * MINUTE : interval.startAt + (laytime - counted) * 2 * MINUTE;
    }
    counted += countedHere; cursor = interval.endAt;
    lines.push({
      id, kind: interval.kind, startAt: interval.startAt, endAt: interval.endAt, minutes, treatment, countedMinutes: countedHere - minutes,
      clause: rule.clause, evidence: [...interval.evidence, ...clauseRef(rule.clause)],
      note: noteFor(interval.kind, treatment, rule.clause, fullOnDemurrage, Boolean(edit)),
      ...(edit ? { overriddenBy: { kind: "EDIT" as const, id: edit.editId } } : {}),
    });
  }
  plain(completionAt);
  const demurrageMinutes = Math.max(0, counted - laytime);
  const demurrageCents = proRataCents(demurrageMinutes, terms.ratePerHourCents);
  lines.push({ id: "LAYTIME_ALLOWED", kind: "LAYTIME_ALLOWED", minutes: laytime, treatment: "COUNT", countedMinutes: -laytime, evidence: [], note: `Laytime allowed, ${laytime / 60} h`, cents: demurrageCents });
  input.fees.forEach((fee, index) => lines.push({ id: `FEE:${index}`, kind: "FEE", minutes: 0, treatment: "COUNT", countedMinutes: 0, evidence: fee.evidence, note: fee.label.slice(0, 80), cents: fee.cents }));
  const feesCents = input.fees.reduce((sum, fee) => sum + fee.cents, 0);
  return { lines, totals: { countedMinutes: counted, laytimeMinutes: laytime, demurrageMinutes, demurrageCents, feesCents, totalCents: demurrageCents + feesCents, ...(onDemurrageAt !== undefined ? { onDemurrageAt } : {}) } };
}

/** CONTRACTS §5 computeStatement. Memory items count as "used" only when they change at least one line. */
export function computeStatement(input: ComputeInput): { lines: StatementLine[]; totals: StatementTotals; memoryItemIds: string[] } {
  const base = compute(input, input.terms);
  // Overrides apply only to the contract form they were learned for; a statement without a form code gets none.
  const relevant = input.overrides.filter(override => input.formCode !== undefined && override.formCode === input.formCode);
  if (!relevant.length) return { ...base, memoryItemIds: [] };
  const withMemory = compute(input, applyOverrides(input.terms, relevant, input.formCode));
  const changed = new Set(withMemory.lines.filter(line => {
    const before = base.lines.find(candidate => candidate.id === line.id);
    return before && (before.treatment !== line.treatment || before.countedMinutes !== line.countedMinutes) && !line.overriddenBy;
  }).map(line => line.id));
  if (!changed.size) return { ...withMemory, memoryItemIds: [] };
  const used = relevant[relevant.length - 1];
  const lines = withMemory.lines.map(line => changed.has(line.id)
    ? { ...line, overriddenBy: { kind: "MEMORY" as const, id: used.memoryItemId }, evidence: [...line.evidence, { kind: "MEMORY" as const, memoryItemId: used.memoryItemId, version: used.version }] }
    : line);
  return { lines, totals: withMemory.totals, memoryItemIds: [...new Set(relevant.map(override => override.memoryItemId))] };
}

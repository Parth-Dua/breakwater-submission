import { describe, expect, test } from "vitest";
import { detectAisGaps, detectGeofenceEntry, detectMovementIntervals, positionAt, pointInPolygon, distanceToPolygonNm } from "../../../src/domain/geo";
import { computeStatement, type ContractRuleOverride, type IntervalInput } from "../../../src/domain/laytime";
import { buildAccrual, buildRecovery, buildReversalAndAp, validateJournal } from "../../../src/domain/ledger";
import { formatUsd, proRataCents, roundHalfUp } from "../../../src/domain/money";
import { evaluateNor } from "../../../src/domain/nor";
import { belowMateriality, deadlineFallbackDue, routeAsk, withinDelegation } from "../../../src/domain/policy";
import { reconcileInvoice, type ExtractedInvoice } from "../../../src/domain/reconcile";
import { resolveCapabilities, toolOffered } from "../../../src/domain/capabilities";
import { checkPostconditions, type CaseSnapshot } from "../../../src/domain/postconditions";
import { buildProvenance, citationsAllowed, templateExplanation } from "../../../src/domain/provenance";
import { localToUtc, sofTextToIso, utc } from "../../../src/domain/time";
import { portByCode } from "../../../src/world/company";
import { ALNOOR_SC_0611, HANSA_SC_0917, LITORAL_PC_0802, NORDHAVN_CP_2019, OKEANOS_CP_2020, THALASSA_CP_2021 } from "../../../src/world/contracts";
import { FORMS } from "../../../src/world/forms";
import { generateHistory } from "../../../src/world/history";
import { POLICIES } from "../../../src/world/policies";
import { generateScoreboard } from "../../../src/world/scoreboard";
import { ASTER_VALE_TRACK } from "../../../src/world/scripts";
import type { HistoryCase } from "../../../src/world/types";

const RTM = portByCode("NLRTM");
const POLICY_SET = Object.fromEntries(POLICIES.map(policy => [policy.code, policy.params]));
const closure: IntervalInput = { kind: "PORT_CLOSURE", startAt: utc("2026-10-28T12:00"), endAt: utc("2026-10-29T12:00"), verified: true, evidence: [] };
const shifting: IntervalInput = { kind: "SHIFTING", startAt: utc("2026-10-30T08:00"), endAt: utc("2026-10-30T12:00"), verified: true, evidence: [] };
const phyto: IntervalInput = { kind: "CUSTOMS_HOLD", startAt: utc("2026-10-30T12:00"), endAt: utc("2026-10-31T18:00"), verified: true, evidence: [] };
const AV = [closure, shifting, phyto];
const OVERRIDE: ContractRuleOverride = { memoryItemId: "M-0002", version: 1, formCode: "NORDHAVN-CP-2019", clause: "8", rule: "EXCEPTIONS_APPLY_ON_DEMURRAGE", value: false };
const payable = (extra: Partial<Parameters<typeof computeStatement>[0]> = {}) => computeStatement({ side: "PAYABLE", terms: NORDHAVN_CP_2019, formCode: "NORDHAVN-CP-2019", contractId: "cp", laytimeStartAt: utc("2026-10-25T00:00"), completionAt: utc("2026-11-02T06:00"), intervals: AV, fees: [], overrides: [], edits: [], ...extra });
const AV_INVOICE: ExtractedInvoice = { invoiceNo: "2611", currency: "USD", laytimeStartAt: utc("2026-10-24T12:00"), completionAt: utc("2026-11-02T07:00"), timeUsedMinutes: 12_660, demurrageMinutes: 8_340, demurrageCents: 13_900_000, fees: [{ label: "Communication & admin fee", cents: 15_000 }], totalCents: 13_915_000 };

describe("money (CONTRACTS §1)", () => {
  test("pro rata and half-up rounding; format", () => {
    expect(proRataCents(90, 2_400_000 / 24)).toBe(150_000);
    expect(proRataCents(7_320, 100_000)).toBe(12_200_000);
    expect(roundHalfUp(5n, 2n)).toBe(3);
    expect(roundHalfUp(4n, 3n)).toBe(1);
    expect(proRataCents(1, 62_500)).toBe(1_042); // 1041.67 → 1042
    expect(formatUsd(12_215_000)).toBe("$122,150");
    expect(formatUsd(-1_700_000)).toBe("−$17,000");
    expect(formatUsd(1_200_000, { sign: true })).toBe("+$12,000");
  });
});

describe("geo + NOR on Aster Vale (W-01, W-02, W-07)", () => {
  test("W-01 arrival in port limits 24 Oct 18:00", () => {
    expect(detectGeofenceEntry(ASTER_VALE_TRACK, RTM.anchorage)).toBe(utc("2026-10-24T18:00"));
  });
  test("W-02 NOR invalid as tendered (≈24 nm out), deemed on arrival", () => {
    const position = positionAt(ASTER_VALE_TRACK, utc("2026-10-24T06:00"))!;
    expect(pointInPolygon([position.lon, position.lat], RTM.anchorage)).toBe(false);
    const nor = evaluateNor({ tenderedAt: utc("2026-10-24T06:00"), arrivalAt: utc("2026-10-24T18:00"), positionAtTender: [position.lon, position.lat], portLimits: RTM.anchorage, terms: NORDHAVN_CP_2019 });
    expect(nor).toMatchObject({ valid: false, reason: "DEEMED_ON_ARRIVAL", effectiveAt: utc("2026-10-24T18:00"), laytimeStartAt: utc("2026-10-25T00:00") });
    expect(nor.distanceNm).toBeGreaterThanOrEqual(23.5);
    expect(nor.distanceNm).toBeLessThanOrEqual(24.5);
    const sale = evaluateNor({ tenderedAt: utc("2026-10-24T06:00"), arrivalAt: utc("2026-10-24T18:00"), positionAtTender: [position.lon, position.lat], portLimits: RTM.anchorage, terms: HANSA_SC_0917 });
    expect(sale.laytimeStartAt).toBe(utc("2026-10-25T06:00")); // W-04
    expect(distanceToPolygonNm([3.7, 52.0], RTM.anchorage)).toBe(0);
  });
  test("W-07 shifting 08:00–12:00 from AIS; no dark gaps", () => {
    const movements = detectMovementIntervals(ASTER_VALE_TRACK.filter(point => point.at > utc("2026-10-25T00:00")));
    expect(movements).toEqual([{ startAt: utc("2026-10-30T08:00"), endAt: utc("2026-10-30T12:00") }]);
    expect(detectAisGaps(ASTER_VALE_TRACK)).toEqual([]);
  });
  test("W-09 SOF local times convert DST-aware", () => {
    expect(localToUtc(sofTextToIso("02.11 07:00", 2026), "Europe/Amsterdam")).toBe(utc("2026-11-02T06:00"));
    expect(localToUtc(sofTextToIso("24.10 20:00", 2026), "Europe/Amsterdam")).toBe(utc("2026-10-24T18:00"));
  });
});

describe("laytime engine — WORLD §5 answer key", () => {
  test("W-05/W-10 register terms: on demurrage 28 Oct 00:00; 6,600 min; $110,000", () => {
    const result = payable();
    expect(result.totals).toMatchObject({ onDemurrageAt: utc("2026-10-28T00:00"), countedMinutes: 10_920, demurrageMinutes: 6_600, demurrageCents: 11_000_000 });
    expect(result.lines.find(line => line.kind === "PORT_CLOSURE")).toMatchObject({ treatment: "HALF", countedMinutes: -720, clause: "8" });
    expect(result.lines.find(line => line.kind === "SHIFTING")).toMatchObject({ treatment: "EXCLUDE", countedMinutes: -240 });
    expect(result.memoryItemIds).toEqual([]);
    expect(result.lines.every(line => line.note.length <= 80)).toBe(true);
  });
  test("W-11 memory override (cl. 8 proviso): 7,320 min; $122,000; line attributed to memory", () => {
    const result = payable({ overrides: [OVERRIDE] });
    expect(result.totals).toMatchObject({ demurrageMinutes: 7_320, demurrageCents: 12_200_000 });
    expect(result.memoryItemIds).toEqual(["M-0002"]);
    expect(result.lines.find(line => line.kind === "PORT_CLOSURE")).toMatchObject({ treatment: "COUNT", countedMinutes: 0, overriddenBy: { kind: "MEMORY", id: "M-0002" } });
    expect(result.lines.find(line => line.kind === "PORT_CLOSURE")!.note).toMatch(/already on demurrage/);
    // An override for another contract form is never used.
    expect(payable({ overrides: [{ ...OVERRIDE, formCode: "THALASSA-CP-2021" }] }).memoryItemIds).toEqual([]);
  });
  test("Controller edit HALF→COUNT reaches the same total and is marked as an edit", () => {
    const result = payable({ edits: [{ editId: "E1", lineId: `PORT_CLOSURE:${closure.startAt}`, treatment: "COUNT" }] });
    expect(result.totals.demurrageCents).toBe(12_200_000);
    expect(result.lines.find(line => line.kind === "PORT_CLOSURE")?.overriddenBy).toEqual({ kind: "EDIT", id: "E1" });
  });
  test("W-12 recoverable (HANSA): 6,240 min; $93,600", () => {
    const result = computeStatement({ side: "RECOVERABLE", terms: HANSA_SC_0917, laytimeStartAt: utc("2026-10-25T06:00"), completionAt: utc("2026-11-02T06:00"), intervals: AV, fees: [], overrides: [OVERRIDE], edits: [] });
    expect(result.totals).toMatchObject({ demurrageMinutes: 6_240, demurrageCents: 9_360_000 });
    expect(result.memoryItemIds).toEqual([]); // the NORDHAVN override never touches the sale contract
  });
  test("W-14 Oct accrual estimate $80,000; Nov true-up $30,000", () => {
    const october = payable({ completionAt: utc("2026-11-01T00:00") });
    expect(october.totals.demurrageCents).toBe(8_000_000);
    expect(buildAccrual("DC-2026-0412", 8_000_000, 0)).toMatchObject({ kind: "ACCRUAL", lines: [{ account: "5100", side: "DEBIT", cents: 8_000_000 }, { account: "2150", side: "CREDIT", cents: 8_000_000 }] });
    expect(buildAccrual("DC-2026-0412", 11_000_000, 8_000_000)).toMatchObject({ kind: "ACCRUAL_TRUEUP", lines: [{ cents: 3_000_000 }, { cents: 3_000_000 }] });
    expect(buildAccrual("DC-2026-0412", 8_000_000, 8_000_000)).toBeNull();
  });
  test("overlapping intervals are rejected; unverified holds are excluded", () => {
    expect(() => payable({ intervals: [closure, { ...closure, startAt: closure.startAt + 3_600_000, endAt: closure.endAt + 3_600_000 }] })).toThrow(/overlap/);
    const unverified = computeStatement({ side: "RECOVERABLE", terms: LITORAL_PC_0802, laytimeStartAt: utc("2026-10-01T15:00"), completionAt: utc("2026-10-07T15:00"), intervals: [{ kind: "CUSTOMS_HOLD", startAt: utc("2026-10-03T17:00"), endAt: utc("2026-10-04T05:00"), verified: false, evidence: [] }], fees: [], overrides: [], edits: [] });
    expect(unverified.totals.demurrageCents).toBe(1_800_000);
    expect(unverified.lines.find(line => line.kind === "CUSTOMS_HOLD")?.note).toBe("Customs hold unverified; excluded");
  });
  test("W-20..W-26 Kestrel and Halden Star", () => {
    const hold = (verified: boolean): IntervalInput => ({ kind: "CUSTOMS_HOLD", startAt: utc("2026-10-03T17:00"), endAt: utc("2026-10-04T05:00"), verified, evidence: [] });
    const run = (terms: typeof THALASSA_CP_2021, start: string, end: string, intervals: IntervalInput[]) => computeStatement({ side: "PAYABLE", terms, laytimeStartAt: utc(start), completionAt: utc(end), intervals, fees: [], overrides: [], edits: [] }).totals.demurrageCents;
    expect(run(THALASSA_CP_2021, "2026-10-01T15:00", "2026-10-07T15:00", [hold(true)])).toBe(3_600_000);
    expect(run(LITORAL_PC_0802, "2026-10-01T15:00", "2026-10-07T15:00", [hold(true)])).toBe(2_700_000);
    expect(run(LITORAL_PC_0802, "2026-10-01T15:00", "2026-10-07T15:00", [hold(false)])).toBe(1_800_000);
    expect(run(OKEANOS_CP_2020, "2026-10-12T12:00", "2026-10-17T12:00", [])).toBe(3_000_000);
    expect(run(ALNOOR_SC_0611, "2026-10-12T18:00", "2026-10-17T12:00", [])).toBe(2_700_000);
  });
});

describe("W-13 reconciliation of the Nordhavn invoice", () => {
  test("register view: 4 variances, fee accepted below materiality, dispute $29,000", () => {
    const statement = payable();
    const result = reconcileInvoice(statement.lines, statement.totals, AV_INVOICE, 25_000, 100_000);
    expect(result.variances.map(variance => [variance.kind, variance.minutes, variance.cents])).toEqual([
      ["LAYTIME_START", 720, 1_200_000], ["COMPLETION_TIME", 60, 100_000], ["PORT_CLOSURE", 720, 1_200_000], ["SHIFTING", 240, 400_000],
    ]);
    expect(result.acceptedBelowMateriality.map(variance => variance.cents)).toEqual([15_000]);
    expect(result.payableCents).toBe(11_015_000);
    expect(result.disputeCents).toBe(2_900_000);
  });
  test("after the cl. 8 correction: 3 variances, payable $122,150, dispute $17,000", () => {
    const statement = payable({ overrides: [OVERRIDE] });
    const result = reconcileInvoice(statement.lines, statement.totals, AV_INVOICE, 25_000, 100_000);
    expect(result.variances.map(variance => [variance.kind, variance.cents])).toEqual([["LAYTIME_START", 1_200_000], ["COMPLETION_TIME", 100_000], ["SHIFTING", 400_000]]);
    expect(result.payableCents).toBe(12_215_000);
    expect(result.disputeCents).toBe(1_700_000);
  });
});

function engineFor(item: HistoryCase, side: "PAYABLE" | "RECOVERABLE") {
  const cpForm = FORMS[item.voyage.charterCode.split("/")[0]];
  const cargoForm = FORMS[item.voyage.cargoContractCode.replace(/-(H|SC-)\d+$/, "")];
  const truth = side === "PAYABLE" ? item.truth.payable : item.truth.recoverable;
  const terms = side === "PAYABLE" ? cpForm.truth : cargoForm.truth;
  const requiresRelease = (kind: string) => Boolean(terms.treatments[kind as "CUSTOMS_HOLD"]?.requiresEvidence?.length);
  return computeStatement({
    side, terms, laytimeStartAt: truth.laytimeStartAt, completionAt: truth.completionAt,
    intervals: item.intervals.map(interval => ({ ...interval, verified: requiresRelease(interval.kind) ? item.outcome.customsResolution === "VERIFIED" || (item as { answerKey?: { responder: { confirmFacts: string | null } } }).answerKey?.responder.confirmFacts === "CONFIRM" : interval.verified, evidence: [] })),
    fees: side === "PAYABLE" ? item.ownerInvoice.lines.filter(line => line.minutes === undefined && line.cents < 25_000).map(line => ({ label: line.label, cents: line.cents, evidence: [] })) : [],
    overrides: [], edits: [],
  });
}

describe("engine ≡ generator ground truth (independent implementations)", () => {
  test("all 32 history cases and 24 scoreboard voyages agree to the cent", () => {
    const cases: HistoryCase[] = [...generateHistory(), ...generateScoreboard()];
    for (const item of cases) {
      expect(engineFor(item, "PAYABLE").totals.totalCents, `${item.caseCode} payable`).toBe(item.truth.payable.totalCents);
      expect(engineFor(item, "RECOVERABLE").totals.totalCents, `${item.caseCode} recoverable`).toBe(item.truth.recoverable.totalCents);
    }
  });
  test("scoreboard: reconciliation reproduces every answer-key dispute amount and dispute lines", () => {
    const toUtc = (text: string) => { const [d, mon, y, hm] = text.split(" "); return Date.parse(`${d} ${mon} ${y} ${hm} UTC`); };
    for (const voyage of generateScoreboard()) {
      const statement = engineFor(voyage, "PAYABLE");
      const invoice: ExtractedInvoice = {
        invoiceNo: voyage.ownerInvoice.invoiceNo, currency: voyage.ownerInvoice.currency,
        laytimeStartAt: toUtc(voyage.ownerInvoice.laytimeStartText), completionAt: toUtc(voyage.ownerInvoice.completionText),
        timeUsedMinutes: voyage.ownerInvoice.lines.find(line => line.label === "Time used")!.minutes!,
        demurrageMinutes: voyage.ownerInvoice.lines.find(line => line.label === "Demurrage")!.minutes!,
        demurrageCents: voyage.ownerInvoice.lines.find(line => line.label === "Demurrage")!.cents,
        fees: voyage.ownerInvoice.lines.filter(line => line.minutes === undefined).map(line => ({ label: line.label, cents: line.cents })),
        totalCents: voyage.ownerInvoice.totalCents,
      };
      const statementNoFees = { ...statement, totals: { ...statement.totals, totalCents: statement.totals.demurrageCents } };
      const result = reconcileInvoice(statementNoFees.lines, statementNoFees.totals, invoice, 25_000, FORMS[voyage.voyage.charterCode.split("/")[0]].truth.ratePerHourCents);
      expect(result.disputeCents, voyage.caseCode).toBe(voyage.answerKey.disputeCents);
      const kinds = result.variances.map(variance => variance.kind === "LAYTIME_START" ? "LAYTIME_START" : variance.kind === "COMPLETION_TIME" ? "COMPLETION_TIME" : variance.kind).filter(kind => kind !== "CURRENCY");
      expect(kinds.sort(), voyage.caseCode).toEqual([...voyage.answerKey.disputeLines].sort());
    }
  });
});

describe("policy, ledger, capabilities, postconditions, provenance", () => {
  test("routing and delegation (WORLD §9)", () => {
    expect(routeAsk({ need: "PAYMENT", amountCents: 11_015_000, policies: POLICY_SET })).toEqual({ required: true, role: "controller", policyCode: "AP_POSTING" });
    expect(routeAsk({ need: "PAYMENT", amountCents: 3_600_000, ctx: { statementComplete: true }, policies: POLICY_SET }).required).toBe(false);
    expect(routeAsk({ need: "PAYMENT", amountCents: 3_600_000, ctx: { openDisputeAboveMateriality: true }, policies: POLICY_SET }).role).toBe("controller");
    expect(routeAsk({ need: "RECOVERY_FILING", amountCents: 9_360_000, ctx: { counterpartyStrategic: true }, policies: POLICY_SET }).role).toBe("trader");
    expect(routeAsk({ need: "RECOVERY_FILING", amountCents: 2_700_000, ctx: { counterpartyStrategic: false }, policies: POLICY_SET }).required).toBe(false);
    expect(routeAsk({ need: "FACT", policies: POLICY_SET }).role).toBe("ops");
    expect(withinDelegation("ACCRUAL", 11_000_000, {}, POLICY_SET)).toBe(true);
    expect(belowMateriality(15_000, POLICY_SET)).toBe(true);
    expect(belowMateriality(60_000, POLICY_SET)).toBe(false);
    expect(deadlineFallbackDue({ kind: "COMMERCIAL_DECISION", status: "OPEN" }, utc("2026-11-28T06:00"), utc("2026-12-02T06:00"), POLICY_SET)).toBe(true);
    expect(deadlineFallbackDue({ kind: "COMMERCIAL_DECISION", status: "OPEN" }, utc("2026-11-02T12:00"), utc("2026-12-02T06:00"), POLICY_SET)).toBe(false);
  });
  test("journals: reversal + AP, recovery, validation", () => {
    const period = { code: "2026-12", startAt: utc("2026-12-01T00:00"), endAt: utc("2027-01-01T00:00"), status: "OPEN" as const };
    const [reversal, ap] = buildReversalAndAp("DC-2026-0412", 11_000_000, 12_215_000, "owner");
    expect(reversal.lines).toEqual([{ account: "2150", side: "DEBIT", cents: 11_000_000 }, { account: "5100", side: "CREDIT", cents: 11_000_000 }]);
    expect(ap.lines).toEqual([{ account: "5100", side: "DEBIT", cents: 12_215_000 }, { account: "2000", counterpartyId: "owner", side: "CREDIT", cents: 12_215_000 }]);
    expect(validateJournal(ap, period, utc("2026-12-09T10:00"))).toEqual({ ok: true });
    expect(validateJournal(ap, { ...period, status: "LOCKED" }, utc("2026-12-09T10:00"))).toEqual({ ok: false, code: "PERIOD_LOCKED" });
    expect(validateJournal(ap, period, utc("2026-11-30T10:00"))).toEqual({ ok: false, code: "OUT_OF_PERIOD" });
    expect(validateJournal({ ...ap, lines: [ap.lines[0]] }, period, utc("2026-12-09T10:00"))).toEqual({ ok: false, code: "UNBALANCED" });
    expect(validateJournal({ kind: "AP", memo: "", lines: [{ account: "1000", side: "DEBIT", cents: 1 }, { account: "2000", side: "CREDIT", cents: 1 }] }, period, utc("2026-12-09T10:00"))).toEqual({ ok: false, code: "IMPORT_ONLY" });
    expect(buildRecovery("DC-2026-0412", 9_060_000, "hansa").lines).toEqual([{ account: "1200", counterpartyId: "hansa", side: "DEBIT", cents: 9_060_000 }, { account: "5190", side: "CREDIT", cents: 9_060_000 }]);
  });
  test("capabilities: the customs portal tool is hidden until a procedure grants it", () => {
    expect(toolOffered(resolveCapabilities([]), "search_customs_portal")).toBe(false);
    expect(toolOffered(resolveCapabilities([]), "search_mailbox")).toBe(true);
    const granted = resolveCapabilities([{ memoryItemId: "M-0001", version: 1, grants: [{ system: "CUSTOMS_PORTAL", scope: "CASE_VESSEL_AND_INTERVAL" }] }]);
    expect(toolOffered(granted, "search_customs_portal")).toBe(true);
    expect(granted.find(capability => capability.system === "CUSTOMS_PORTAL")?.grantedBy).toEqual({ memoryItemId: "M-0001", version: 1 });
  });
  test("W-24/W-26: an unverified hold counts where the clause counts it anyway; excluded where the clause needs a record", () => {
    const start = utc("2026-10-01T15:00"), end = utc("2026-10-07T15:00");
    const hold: IntervalInput = { kind: "CUSTOMS_HOLD", startAt: utc("2026-10-03T17:00"), endAt: utc("2026-10-04T05:00"), verified: false, evidence: [] };
    const run = (terms: typeof THALASSA_CP_2021, side: "PAYABLE" | "RECOVERABLE", verified: boolean) =>
      computeStatement({ side, terms, laytimeStartAt: start, completionAt: end, intervals: [{ ...hold, verified }], fees: [], overrides: [], edits: [] }).totals.totalCents;
    expect(run(THALASSA_CP_2021, "PAYABLE", false)).toBe(3_600_000);
    expect(run(LITORAL_PC_0802, "RECOVERABLE", false)).toBe(1_800_000);
    expect(run(LITORAL_PC_0802, "RECOVERABLE", true)).toBe(2_700_000);
  });
  test("postconditions per task kind (CONTRACTS §9)", () => {
    const empty: CaseSnapshot = { factKeys: [], intervals: [], statementVersions: {}, openAskKinds: [] };
    // Laytime starts are required once arrival is known (a NOR before arrival is deemed tendered on arrival).
    expect(checkPostconditions("DOCUMENT_RECEIVED", empty, { ...empty, documentKind: "NOR", factKeys: ["NOR_TENDERED", "NOR_VALIDITY"] }).ok).toBe(true);
    expect(checkPostconditions("DOCUMENT_RECEIVED", empty, { ...empty, documentKind: "NOR", factKeys: ["NOR_TENDERED", "NOR_VALIDITY", "ARRIVAL_IN_PORT_LIMITS"] }).missing).toEqual(["LAYTIME_START_PAYABLE", "LAYTIME_START_RECOVERABLE"]);
    expect(checkPostconditions("AIS_UPDATE", empty, { ...empty, factKeys: ["NOR_TENDERED", "ARRIVAL_IN_PORT_LIMITS"], aisBatch: { entryDetected: true, entryRecorded: true, movements: 0, movementsRecorded: 0 } }).missing).toEqual(["LAYTIME_START_PAYABLE", "LAYTIME_START_RECOVERABLE"]);
    expect(checkPostconditions("DOCUMENT_RECEIVED", empty, { ...empty, documentKind: "SOF", factKeys: ["COMPLETION"], sof: { rows: 9, mapped: 9 }, statementVersions: { PAYABLE: 1, RECOVERABLE: 1 }, recoveryRequired: true }).missing).toEqual(["recovery filing or routed ask"]);
    expect(checkPostconditions("DOCUMENT_RECEIVED", empty, { ...empty, documentKind: "SOF", factKeys: ["COMPLETION"], sof: { rows: 9, mapped: 9 }, intervals: [{ kind: "CUSTOMS_HOLD", verified: false, hasOpenAsk: false }], statementVersions: { PAYABLE: 1, RECOVERABLE: 1 } }).missing).toEqual(["customs hold neither verified nor asked"]);
    expect(checkPostconditions("DOCUMENT_RECEIVED", empty, { ...empty, documentKind: "OWNER_INVOICE", reconciliation: true, openAskKinds: ["PAYMENT_APPROVAL"] }).ok).toBe(true);
    expect(checkPostconditions("MONTH_END", empty, { ...empty, monthEnd: { candidateCaseIds: ["a", "b"], handledCaseIds: ["a"] } }).missing).toEqual(["accrual for case b"]);
    expect(checkPostconditions("DEADLINE_CHECK", empty, { ...empty, filingExists: true }).ok).toBe(true);
  });
  test("provenance: citations restricted to the graph; deterministic fallback", () => {
    const lines = payable({ intervals: [{ ...shifting, evidence: [{ kind: "AIS", vesselId: "v", from: shifting.startAt, to: shifting.endAt }] }, closure, phyto] }).lines;
    const graph = buildProvenance({ type: "STATEMENT_LINE", id: `SHIFTING:${shifting.startAt}` }, { lines });
    expect(graph.citations).toEqual([{ kind: "AIS", vesselId: "v", from: shifting.startAt, to: shifting.endAt }, { kind: "CLAUSE", contractId: "cp", clause: "7" }]);
    expect(citationsAllowed(graph, [{ kind: "CLAUSE", contractId: "cp", clause: "7" }])).toBe(true);
    expect(citationsAllowed(graph, [{ kind: "CLAUSE", contractId: "cp", clause: "9" }])).toBe(false);
    expect(templateExplanation(graph)).toBe("Shifting to berth; excluded (cl. 7) (-240 min).");
  });
});

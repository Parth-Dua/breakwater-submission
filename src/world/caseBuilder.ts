// Builds one internally consistent demurrage case from a recipe: AIS track, SOF (local time), owner invoice
// (with the owner's own errors), ground-truth statements, documents and journals. Used by history and scoreboard.
import { DateTime } from "luxon";
import { buildTrack, distanceNm, type Waypoint } from "./ais";
import { counterpartyByCode, portByCode, vesselByCode } from "./company";
import { periodFor } from "./policies";
import { proRata, truthStatement } from "./truth";
import type { ContractTerms, CustomsRecordDef, DocumentSpec, ExceptionKind, HistoryCase, IntervalTruth, JournalDef, PatternTag, SofRow, VoyageDef } from "./types";

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
export const MATERIALITY_CENTS = 25_000;

export type ExceptionRecipe = { kind: ExceptionKind; startAt: number; endAt: number; customsEvidence?: "PORTAL_RELEASE" | "PORTAL_RELEASE_OUTSIDE" | "NONE" };
export type CaseRecipe = {
  caseCode: string; voyageCode: string; vesselCode: string; portCode: string; operation: "LOAD" | "DISCHARGE";
  ownerCode: string; cargoCode: string;
  cp: { code: string; formCode: string; registerTerms: ContractTerms; trueTerms: ContractTerms };
  cargo: { code: string; formCode: string; kind: "SALE" | "PURCHASE"; terms: ContractTerms };
  arrivalAt: number;
  norTenderedAt: number;              // < arrivalAt means premature (vessel waits outside port limits)
  completionAt: number;
  exceptions: ExceptionRecipe[];
  plants: { sofLocalAsUtc?: boolean; shiftingBilled?: boolean; adminFeeCents?: number; eurInvoice?: boolean; duplicateInvoice?: boolean; aisGap?: { startAt: number; endAt: number } };
  invoiceReceivedAt: number;
  invoiceNo: string;
  waiver?: { cents: number; reason: string };
  patterns: PatternTag[];
  seed: string;
};

const fmtUtc = (at: number) => DateTime.fromMillis(at, { zone: "utc" }).toFormat("d LLL yyyy HH:mm");

/** "dd.MM HH:mm" in the port zone, with fold set for the repeated hour when DST ends. */
export function localSofText(at: number, ianaZone: string): { localText: string; fold?: 0 | 1 } {
  const local = DateTime.fromMillis(at, { zone: ianaZone });
  const localText = local.toFormat("dd.LL HH:mm");
  const earlier = DateTime.fromMillis(at - HOUR, { zone: ianaZone });
  const later = DateTime.fromMillis(at + HOUR, { zone: ianaZone });
  const sameWallEarlier = earlier.toFormat("dd.LL HH:mm") === localText;
  const sameWallLater = later.toFormat("dd.LL HH:mm") === localText;
  return sameWallEarlier ? { localText, fold: 1 } : sameWallLater ? { localText, fold: 0 } : { localText };
}

function centroid(polygon: { coordinates: number[][][] }): [number, number] {
  const ring = polygon.coordinates[0].slice(0, -1);
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
}

export function buildCase(recipe: CaseRecipe): HistoryCase {
  const port = portByCode(recipe.portCode);
  const vessel = vesselByCode(recipe.vesselCode);
  const zone = port.ianaZone;
  const anchor = centroid(port.anchorage);
  const berth = centroid(port.berth);
  const westLon = port.anchorage.coordinates[0][0][0];
  // Drift/approach position ~24 nm outside the west edge of port limits.
  const degLon = 24 / (60 * Math.cos((anchor[1] * Math.PI) / 180));
  const outside: [number, number] = [Number((westLon - degLon).toFixed(4)), Number(anchor[1].toFixed(4))];
  const premature = recipe.norTenderedAt < recipe.arrivalAt;

  // ---- AIS ----
  const waypoints: Waypoint[] = [];
  const approachStart = Math.min(recipe.norTenderedAt, recipe.arrivalAt) - 12 * HOUR;
  const far: [number, number] = [outside[0] - degLon * 2, outside[1] - 0.3];
  waypoints.push({ at: approachStart, lon: far[0], lat: far[1] });
  if (premature) {
    const driftFrom = recipe.norTenderedAt - 3 * HOUR;
    waypoints.push({ at: driftFrom, lon: outside[0], lat: outside[1] }, { at: recipe.arrivalAt - 4 * HOUR, lon: outside[0], lat: outside[1] });
  } else {
    waypoints.push({ at: recipe.arrivalAt - 4 * HOUR, lon: outside[0], lat: outside[1] });
  }
  waypoints.push({ at: recipe.arrivalAt, lon: anchor[0], lat: anchor[1] });
  const shifting = recipe.exceptions.find(exception => exception.kind === "SHIFTING");
  const shiftStart = shifting ? shifting.startAt : recipe.arrivalAt + 2 * HOUR;
  const shiftEnd = shifting ? shifting.endAt : recipe.arrivalAt + 4 * HOUR;
  waypoints.push({ at: shiftStart, lon: anchor[0], lat: anchor[1] }, { at: shiftEnd, lon: berth[0], lat: berth[1] });
  waypoints.push({ at: recipe.completionAt + 6 * HOUR, lon: berth[0], lat: berth[1] });
  const ais = buildTrack(waypoints, { jitterSeed: `${recipe.seed}:ais`, gaps: recipe.plants.aisGap ? [recipe.plants.aisGap] : undefined });

  // ---- NOR validity and laytime starts (true view) ----
  const cp = recipe.cp, cargo = recipe.cargo;
  const effectiveNor = Math.max(recipe.norTenderedAt, recipe.arrivalAt);
  const cpStart = effectiveNor + cp.trueTerms.noticeMinutes * MINUTE;
  const cargoStart = effectiveNor + cargo.terms.noticeMinutes * MINUTE;

  // ---- intervals (verification per contract) ----
  const coversHold = (exception: ExceptionRecipe) => exception.kind !== "CUSTOMS_HOLD" || exception.customsEvidence === "PORTAL_RELEASE";
  const cpIntervals: IntervalTruth[] = recipe.exceptions.map(exception => ({ kind: exception.kind, startAt: exception.startAt, endAt: exception.endAt, verified: true }));
  const cargoIntervals: IntervalTruth[] = recipe.exceptions.map(exception => ({
    kind: exception.kind, startAt: exception.startAt, endAt: exception.endAt,
    verified: cargo.terms.treatments[exception.kind].requiresEvidence?.includes("CUSTOMS_RELEASE") ? coversHold(exception) : true,
  }));
  const fees = recipe.plants.adminFeeCents ? [{ label: "Communication & admin fee", cents: recipe.plants.adminFeeCents }] : [];
  // A fee not in the CP is accepted only below materiality (WORLD §9: $250); above it is disputed.
  const acceptedFees = fees.filter(fee => fee.cents < MATERIALITY_CENTS);
  const payable = truthStatement({ terms: cp.trueTerms, laytimeStartAt: cpStart, completionAt: recipe.completionAt, intervals: cpIntervals, fees: acceptedFees });
  const recoverable = truthStatement({ terms: cargo.terms, laytimeStartAt: cargoStart, completionAt: recipe.completionAt, intervals: cargoIntervals });

  // ---- owner invoice (owner's view and errors) ----
  const ownerStart = recipe.norTenderedAt + cp.trueTerms.noticeMinutes * MINUTE;
  const offsetMinutes = DateTime.fromMillis(recipe.completionAt, { zone }).offset;
  const ownerEnd = recipe.plants.sofLocalAsUtc ? recipe.completionAt + offsetMinutes * MINUTE : recipe.completionAt;
  const ownerTerms: ContractTerms = recipe.plants.shiftingBilled
    ? { ...cp.trueTerms, treatments: { ...cp.trueTerms.treatments, SHIFTING: { ...cp.trueTerms.treatments.SHIFTING, treatment: "COUNT" } } }
    : cp.trueTerms;
  const owner = truthStatement({ terms: ownerTerms, laytimeStartAt: ownerStart, completionAt: ownerEnd, intervals: cpIntervals, fees });
  const ownerInvoice = {
    invoiceNo: recipe.invoiceNo,
    receivedAt: recipe.invoiceReceivedAt,
    laytimeStartText: fmtUtc(ownerStart),
    completionText: fmtUtc(ownerEnd),
    lines: [
      { label: "Time used", minutes: owner.countedMinutes, cents: 0 },
      { label: "Less laytime allowed", minutes: -owner.laytimeMinutes, cents: 0 },
      { label: "Demurrage", minutes: owner.demurrageMinutes, cents: owner.demurrageCents },
      ...fees.map(fee => ({ label: fee.label, cents: fee.cents })),
    ],
    totalCents: owner.totalCents,
    currency: recipe.plants.eurInvoice ? "EUR" as const : "USD" as const,
    duplicateOf: undefined as string | undefined,
  };

  // ---- SOF (port agent, local time) ----
  const sofEvents: { at: number; entry: string }[] = [];
  if (premature) sofEvents.push({ at: recipe.norTenderedAt - 3 * HOUR, entry: "Vessel arrived off port, drifting" });
  sofEvents.push({ at: recipe.norTenderedAt, entry: "NOR tendered by Master" });
  sofEvents.push({ at: recipe.arrivalAt, entry: `Anchored ${port.anchorageName}` });
  if (!shifting) sofEvents.push({ at: shiftEnd, entry: `All fast ${port.berthName}` });
  for (const exception of recipe.exceptions) {
    const labels: Record<ExceptionKind, [string, string]> = {
      PORT_CLOSURE: ["Port closed by Harbour Master", "Port reopened"],
      WEATHER: ["Operations stopped, bad weather", "Weather cleared, operations resumed"],
      SHIFTING: ["Anchor aweigh, shifting to berth", `All fast ${port.berthName}`],
      CUSTOMS_HOLD: [recipe.operation === "LOAD" ? "Customs inspection, cargo on hold" : "Phytosanitary inspection commenced, cargo on hold", "Cargo released"],
    };
    sofEvents.push({ at: exception.startAt, entry: labels[exception.kind][0] }, { at: exception.endAt, entry: labels[exception.kind][1] });
  }
  sofEvents.push({ at: recipe.completionAt, entry: recipe.operation === "LOAD" ? "Loading completed" : "Discharge completed" });
  sofEvents.sort((a, b) => a.at - b.at);
  const sofRows: SofRow[] = sofEvents.map(event => ({ ...localSofText(event.at, zone), entry: event.entry }));

  // ---- customs portal records ----
  const customs: CustomsRecordDef[] = [];
  const documents: DocumentSpec[] = [];
  const cargoParty = counterpartyByCode(recipe.cargoCode);
  const ownerParty = counterpartyByCode(recipe.ownerCode);
  recipe.exceptions.filter(exception => exception.kind === "CUSTOMS_HOLD").forEach((exception, index) => {
    const holdCode = `DOC-${recipe.caseCode}-CUSTOMS-HOLD-${index + 1}`;
    customs.push({ portCode: recipe.portCode, vesselCode: recipe.vesselCode, kind: "HOLD", startAt: exception.startAt, documentCode: holdCode });
    documents.push({ code: holdCode, kind: "CUSTOMS_HOLD", system: "CUSTOMS_PORTAL", title: `Customs hold · ${vessel.name}`, vesselCode: recipe.vesselCode, portCode: recipe.portCode, receivedAt: exception.startAt, template: "customs-form", data: { authority: port.customsPortalName, vessel: vessel.name, imo: vessel.imo, kind: "HOLD", fromLocal: localSofText(exception.startAt, zone).localText } });
    if (exception.customsEvidence && exception.customsEvidence !== "NONE") {
      const releaseCode = `DOC-${recipe.caseCode}-CUSTOMS-RELEASE-${index + 1}`;
      const coveredFrom = exception.customsEvidence === "PORTAL_RELEASE" ? exception.startAt : exception.endAt + 6 * HOUR;
      const coveredTo = exception.customsEvidence === "PORTAL_RELEASE" ? exception.endAt : exception.endAt + 18 * HOUR;
      customs.push({ portCode: recipe.portCode, vesselCode: recipe.vesselCode, kind: "RELEASE", startAt: coveredFrom, endAt: coveredTo, documentCode: releaseCode });
      documents.push({ code: releaseCode, kind: "CUSTOMS_RELEASE", system: "CUSTOMS_PORTAL", title: `Customs release · ${vessel.name}`, vesselCode: recipe.vesselCode, portCode: recipe.portCode, receivedAt: coveredTo, template: "customs-form", data: { authority: port.customsPortalName, vessel: vessel.name, imo: vessel.imo, kind: "RELEASE", coveredFromLocal: localSofText(coveredFrom, zone).localText, coveredToLocal: localSofText(coveredTo, zone).localText } });
    }
  });
  documents.push(
    { code: `DOC-${recipe.caseCode}-NOR`, kind: "NOR", system: "MAILBOX", title: `NOR · ${vessel.name}`, vesselCode: recipe.vesselCode, portCode: recipe.portCode, receivedAt: recipe.norTenderedAt, template: "nor-email", data: { vessel: vessel.name, imo: vessel.imo, port: port.name, location: port.anchorageName, tenderedText: `${fmtUtc(recipe.norTenderedAt)} UTC`, owner: ownerParty.name } },
    { code: `DOC-${recipe.caseCode}-SOF`, kind: "SOF", system: "MAILBOX", title: `Statement of Facts · ${vessel.name}`, vesselCode: recipe.vesselCode, portCode: recipe.portCode, receivedAt: recipe.completionAt + 6 * HOUR, template: "sof-table", data: { vessel: vessel.name, port: port.name, zone, rows: sofRows } },
    { code: `DOC-${recipe.caseCode}-INVOICE`, kind: "OWNER_INVOICE", system: "MAILBOX", title: `Demurrage invoice ${recipe.invoiceNo}`, vesselCode: recipe.vesselCode, portCode: recipe.portCode, receivedAt: recipe.invoiceReceivedAt, template: "owner-invoice", data: { owner: ownerParty.name, vessel: vessel.name, ...ownerInvoice, ratePerDayCents: cp.trueTerms.ratePerHourCents * 24 } },
  );
  const closure = recipe.exceptions.find(exception => exception.kind === "PORT_CLOSURE");
  if (recipe.plants.duplicateInvoice) documents.push({ code: `DOC-${recipe.caseCode}-INVOICE-DUP`, kind: "OWNER_INVOICE", system: "MAILBOX", title: `Demurrage invoice ${recipe.invoiceNo}-R`, vesselCode: recipe.vesselCode, portCode: recipe.portCode, receivedAt: recipe.invoiceReceivedAt + 3 * DAY, template: "owner-invoice", data: { owner: ownerParty.name, vessel: vessel.name, ...ownerInvoice, invoiceNo: `${recipe.invoiceNo}-R`, duplicateOf: recipe.invoiceNo, ratePerDayCents: cp.trueTerms.ratePerHourCents * 24 } });
  if (closure) documents.push({ code: `DOC-${recipe.caseCode}-CLOSURE`, kind: "PORT_CLOSURE", system: "DOC_STORE", title: `Port closure notice · ${port.name}`, portCode: recipe.portCode, receivedAt: closure.startAt, template: "port-closure-scanned", data: { port: port.name, fromText: `${fmtUtc(closure.startAt)} UTC`, toText: `${fmtUtc(closure.endAt)} UTC` } });

  // ---- outcome ----
  const disputedCents = Math.max(0, ownerInvoice.totalCents - payable.totalCents);
  const waiverCents = recipe.waiver?.cents ?? 0;
  const recoveredCents = recoverable.totalCents - waiverCents;
  const hold = recipe.exceptions.find(exception => exception.kind === "CUSTOMS_HOLD");
  const customsResolution = hold ? (hold.customsEvidence === "PORTAL_RELEASE" ? "VERIFIED" as const : hold.customsEvidence === "PORTAL_RELEASE_OUTSIDE" ? "REJECTED" as const : "ESCALATED" as const) : undefined;

  // ---- journals (history books; all posted at or before 30 Sep 23:59 when the case closes within the window) ----
  const journals: JournalDef[] = [];
  const monthEnd = (at: number) => DateTime.fromMillis(at, { zone: "utc" }).endOf("month").startOf("minute").toMillis();
  const accrualAt = monthEnd(recipe.completionAt);
  const filedAt = recipe.completionAt + DAY;
  const approvedAt = recipe.invoiceReceivedAt + 2 * DAY;
  const add = (code: string, kind: JournalDef["kind"], postedAt: number, memo: string, lines: JournalDef["lines"]) =>
    journals.push({ code: `JE-${recipe.caseCode}-${code}`, caseCode: recipe.caseCode, periodCode: periodFor(postedAt).code, kind, postedAt, memo, lines });
  const accrualCents = payable.demurrageCents;
  if (accrualCents > 0 && accrualAt < approvedAt) add("ACC", "ACCRUAL", accrualAt, "Month-end demurrage accrual", [{ account: "5100", side: "DEBIT", cents: accrualCents }, { account: "2150", side: "CREDIT", cents: accrualCents }]);
  if (recoveredCents > 0) add("AR", "AR_RECOVERY", filedAt, `Demurrage claim filed on ${cargoParty.name}`, [{ account: "1200", counterpartyCode: recipe.cargoCode, side: "DEBIT", cents: recoveredCents }, { account: "5190", side: "CREDIT", cents: recoveredCents }]);
  if (accrualCents > 0 && accrualAt < approvedAt) add("REV", "ACCRUAL_REVERSAL", approvedAt, "Reverse accrual on invoice approval", [{ account: "2150", side: "DEBIT", cents: accrualCents }, { account: "5100", side: "CREDIT", cents: accrualCents }]);
  if (payable.totalCents > 0) add("AP", "AP", approvedAt, `Approved demurrage, ${ownerParty.name}`, [{ account: "5100", side: "DEBIT", cents: payable.totalCents }, { account: "2000", counterpartyCode: recipe.ownerCode, side: "CREDIT", cents: payable.totalCents }]);
  const cutoff = Date.UTC(2026, 8, 30, 23, 59);
  const paidAt = approvedAt + 21 * DAY, receivedAt = filedAt + 28 * DAY;
  if (payable.totalCents > 0 && paidAt <= cutoff) add("PAY", "SETTLEMENT_IMPORT", paidAt, "Imported bank settlement (paid)", [{ account: "2000", counterpartyCode: recipe.ownerCode, side: "DEBIT", cents: payable.totalCents }, { account: "1000", side: "CREDIT", cents: payable.totalCents }]);
  if (recoveredCents > 0 && receivedAt <= cutoff) add("RCV", "SETTLEMENT_IMPORT", receivedAt, "Imported bank settlement (received)", [{ account: "1000", side: "DEBIT", cents: recoveredCents }, { account: "1200", counterpartyCode: recipe.cargoCode, side: "CREDIT", cents: recoveredCents }]);

  const voyage: VoyageDef = { code: recipe.voyageCode, vesselCode: recipe.vesselCode, portCode: recipe.portCode, operation: recipe.operation, charterCode: cp.code, cargoContractCode: cargo.code, eta: recipe.arrivalAt };
  const edits = recipe.patterns.includes("NORDHAVN_CLOSURE_AFTER_DEMURRAGE_COUNTED")
    ? [{ lineKind: "PORT_CLOSURE", from: "HALF" as const, to: "COUNT" as const, clause: "8", note: "CP cl. 8 proviso: already on demurrage" }]
    : [];
  const norPosition = premature ? outside : anchor;
  return {
    caseCode: recipe.caseCode, voyage, ais, arrivalAt: recipe.arrivalAt,
    nor: { tenderedAt: recipe.norTenderedAt, position: [Number(norPosition[0].toFixed(5)), Number(norPosition[1].toFixed(5))] },
    completionAt: recipe.completionAt,
    intervals: cpIntervals,
    sof: { ianaZone: zone, rows: sofRows },
    ownerInvoice,
    truth: { payable, recoverable },
    outcome: { approvedPayableCents: payable.totalCents, disputedCents, recoveredCents, waiverCents, waiverReason: recipe.waiver?.reason, customsResolution, sourceUsed: hold ? (hold.customsEvidence === "NONE" ? "MAILBOX" : "CUSTOMS_PORTAL") : undefined },
    edits, customs, documents, journals, patterns: recipe.patterns,
    openedAt: recipe.arrivalAt - 24 * HOUR,
    closedAt: Math.max(...journals.map(journal => journal.postedAt), approvedAt),
  };
}

/** Distance (nm) from a point to a port-limits polygon edge (planar approximation along the parallel). Used by tests. */
export function distanceToWestEdgeNm(point: [number, number], polygon: { coordinates: number[][][] }): number {
  const west = polygon.coordinates[0][0][0];
  return distanceNm(point, [west, point[1]]);
}

export const DEMURRAGE = { proRata };

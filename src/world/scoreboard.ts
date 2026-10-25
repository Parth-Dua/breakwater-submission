// Scoreboard set (WORLD §8): 24 held-out voyages in namespace `score`, seed SCORE-2026, each planting 0–3 issues.
// The answer key is computed by the generator (truth.ts), never by the agent engine.
import { rng } from "./ais";
import { buildCase, MATERIALITY_CENTS, type CaseRecipe, type ExceptionRecipe } from "./caseBuilder";
import { counterpartyByCode, FLEET } from "./company";
import { CARGO_FORM_BY_PARTY, CP_FORM_BY_OWNER, FORMS, TRADE_LANE } from "./forms";
import type { HistoryCase } from "./types";

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
export const SCORE_SEED = "SCORE-2026";

export type Plant =
  | "PREMATURE_NOR" | "SOF_LOCAL_AS_UTC" | "SHIFTING_BILLED" | "WEATHER_AFTER_DEMURRAGE" | "WEATHER_BEFORE_DEMURRAGE_HALF"
  | "CUSTOMS_RELEASE_IN_PORTAL" | "CUSTOMS_NO_RELEASE" | "ADMIN_FEE_BELOW_MATERIALITY" | "ADMIN_FEE_ABOVE_MATERIALITY"
  | "DUPLICATE_INVOICE" | "AIS_DARK_GAP" | "EUR_INVOICE";

export type ExpectedAsk = { role: "ops" | "controller" | "trader"; kind: "CONFIRM_FACT" | "PAYMENT_APPROVAL" | "COMMERCIAL_DECISION" };
export type ScoreVoyage = HistoryCase & {
  plants: Plant[];
  answerKey: {
    payableCents: number; recoverableCents: number; disputeLines: string[]; disputeCents: number;
    expectedAsks: ExpectedAsk[];
    responder: { confirmFacts: "CONFIRM" | "CANT_FIND" | null; controller: "APPROVE"; trader: "PURSUE" };
  };
};

// Plant sets per voyage (0–3 each). Deterministic list; every catalog entry appears at least once.
const PLANT_SETS: Plant[][] = [
  [], ["PREMATURE_NOR"], ["SOF_LOCAL_AS_UTC"], ["SHIFTING_BILLED"], ["WEATHER_AFTER_DEMURRAGE"], ["WEATHER_BEFORE_DEMURRAGE_HALF"],
  ["CUSTOMS_RELEASE_IN_PORTAL"], ["CUSTOMS_NO_RELEASE"], ["ADMIN_FEE_BELOW_MATERIALITY"], ["ADMIN_FEE_ABOVE_MATERIALITY"], ["DUPLICATE_INVOICE"], ["AIS_DARK_GAP"],
  ["EUR_INVOICE"], ["PREMATURE_NOR", "SHIFTING_BILLED"], ["SOF_LOCAL_AS_UTC", "ADMIN_FEE_BELOW_MATERIALITY"], ["WEATHER_BEFORE_DEMURRAGE_HALF", "SHIFTING_BILLED"],
  ["CUSTOMS_RELEASE_IN_PORTAL", "PREMATURE_NOR"], ["DUPLICATE_INVOICE", "SOF_LOCAL_AS_UTC"], ["AIS_DARK_GAP", "WEATHER_AFTER_DEMURRAGE"], [],
  ["PREMATURE_NOR", "SOF_LOCAL_AS_UTC", "SHIFTING_BILLED"], ["CUSTOMS_NO_RELEASE", "ADMIN_FEE_ABOVE_MATERIALITY"], ["EUR_INVOICE", "WEATHER_BEFORE_DEMURRAGE_HALF"], [],
];

export function generateScoreboard(seed = SCORE_SEED): ScoreVoyage[] {
  const random = rng(seed);
  const pick = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  return PLANT_SETS.map((plants, i) => {
    const has = (plant: Plant) => plants.includes(plant);
    const customs = has("CUSTOMS_RELEASE_IN_PORTAL") || has("CUSTOMS_NO_RELEASE");
    const afterDemurrage = has("WEATHER_AFTER_DEMURRAGE");
    // Customs plants need a purchase contract that requires a release (load ports); weather-after-demurrage uses KAIYO.
    const vessel = afterDemurrage ? FLEET[4] : customs ? FLEET[[1, 3, 6][i % 3]] : FLEET[i % 8];
    // SOF-local-as-UTC over-bills only east of UTC (the real-world error this plant models), so route it to Rotterdam/Alexandria.
    const cargoCode = customs ? (i % 2 ? "PAMPAS" : "LITORAL") : afterDemurrage ? "PAMPAS" : has("SOF_LOCAL_AS_UTC") ? (i % 2 ? "HANSA" : "ALNOOR")
      : ({ NORDHAVN: "HANSA", THALASSA: "LITORAL", OKEANOS: "ALNOOR", PACCREST: "SAIGONAG", KAIYO: "PAMPAS" } as Record<string, string>)[vessel.ownerCode];
    const lane = TRADE_LANE[cargoCode];
    const cpForm = FORMS[CP_FORM_BY_OWNER[vessel.ownerCode]];
    const cargoForm = FORMS[CARGO_FORM_BY_PARTY[cargoCode]];
    const arrivalAt = Date.UTC(2026, 9 + (i % 2), pick(2, 20), pick(0, 20), 0);
    const norTenderedAt = has("PREMATURE_NOR") ? arrivalAt - pick(8, 12) * HOUR : arrivalAt;
    const cpStart = arrivalAt + cpForm.truth.noticeMinutes * MINUTE;
    const exceptions: ExceptionRecipe[] = [];
    let cursor = cpStart + pick(18, 30) * HOUR;
    const place = (kind: ExceptionRecipe["kind"], hours: number, extra: Partial<ExceptionRecipe> = {}) => {
      exceptions.push({ kind, startAt: cursor, endAt: cursor + hours * HOUR, ...extra });
      cursor += hours * HOUR + pick(6, 12) * HOUR;
    };
    if (has("WEATHER_BEFORE_DEMURRAGE_HALF")) place("WEATHER", 2 * pick(5, 9));
    if (has("SHIFTING_BILLED")) place("SHIFTING", pick(3, 5));
    if (has("CUSTOMS_RELEASE_IN_PORTAL")) place("CUSTOMS_HOLD", pick(8, 14), { customsEvidence: "PORTAL_RELEASE" });
    if (has("CUSTOMS_NO_RELEASE")) place("CUSTOMS_HOLD", pick(8, 14), { customsEvidence: "NONE" });
    if (afterDemurrage) { cursor = Math.max(cursor, cpStart + cpForm.truth.laytimeMinutes * MINUTE + pick(8, 16) * HOUR); place("WEATHER", 2 * pick(6, 10)); }
    const exceptionMinutes = exceptions.reduce((sum, exception) => sum + (exception.endAt - exception.startAt) / MINUTE, 0);
    const completionAt = Math.max(cursor, cpStart + (cpForm.truth.laytimeMinutes + exceptionMinutes) * MINUTE) + pick(20, 80) * HOUR;
    const gapStart = cpStart + pick(30, 40) * HOUR;
    const recipe: CaseRecipe = {
      caseCode: `SC-${String(i + 1).padStart(2, "0")}`,
      voyageCode: `SCV-${String(i + 1).padStart(2, "0")}`,
      vesselCode: vessel.code, portCode: lane.portCode, operation: lane.operation, ownerCode: vessel.ownerCode, cargoCode,
      cp: { code: `${cpForm.formCode}/SC-${i + 1}`, formCode: cpForm.formCode, registerTerms: cpForm.register, trueTerms: cpForm.truth },
      cargo: { code: `${cargoForm.formCode}-SC-${i + 1}`, formCode: cargoForm.formCode, kind: cargoForm.kind as "SALE" | "PURCHASE", terms: cargoForm.truth },
      arrivalAt, norTenderedAt, completionAt, exceptions,
      plants: {
        sofLocalAsUtc: has("SOF_LOCAL_AS_UTC"), shiftingBilled: has("SHIFTING_BILLED"),
        adminFeeCents: has("ADMIN_FEE_BELOW_MATERIALITY") ? 15_000 : has("ADMIN_FEE_ABOVE_MATERIALITY") ? 60_000 : undefined,
        eurInvoice: has("EUR_INVOICE"), duplicateInvoice: has("DUPLICATE_INVOICE"),
        aisGap: has("AIS_DARK_GAP") ? { startAt: gapStart, endAt: gapStart + 9 * HOUR } : undefined,
      },
      invoiceReceivedAt: completionAt + pick(5, 12) * DAY,
      invoiceNo: `SCI-${i + 1}`,
      patterns: [],
      seed: `${seed}:${i}`,
    };
    // NORDHAVN is excluded from scoring because its register intentionally disagrees with the signed contract.
    if (recipe.cp.formCode === "NORDHAVN-CP-2019") {
      recipe.cp = { ...recipe.cp, registerTerms: cpForm.truth };
    }
    const built = buildCase(recipe);

    const disputeLines: string[] = [];
    if (has("PREMATURE_NOR")) disputeLines.push("LAYTIME_START");
    if (has("SOF_LOCAL_AS_UTC")) disputeLines.push("COMPLETION_TIME");
    if (has("SHIFTING_BILLED")) disputeLines.push("SHIFTING");
    if (has("ADMIN_FEE_ABOVE_MATERIALITY")) disputeLines.push("FEE");
    const disputeCents = Math.max(0, built.ownerInvoice.totalCents - built.truth.payable.totalCents);
    const expectedAsks: ExpectedAsk[] = [];
    if (customs || has("AIS_DARK_GAP")) expectedAsks.push({ role: "ops", kind: "CONFIRM_FACT" });
    const strategic = counterpartyByCode(cargoCode).strategic;
    if (built.truth.recoverable.totalCents > 0 && (strategic || built.truth.recoverable.totalCents > 5_000_000)) expectedAsks.push({ role: "trader", kind: "COMMERCIAL_DECISION" });
    if (built.truth.payable.totalCents > 5_000_000 || disputeCents >= MATERIALITY_CENTS || has("EUR_INVOICE")) expectedAsks.push({ role: "controller", kind: "PAYMENT_APPROVAL" });
    return {
      ...built,
      plants,
      answerKey: {
        payableCents: built.truth.payable.totalCents,
        recoverableCents: built.truth.recoverable.totalCents,
        disputeLines, disputeCents, expectedAsks,
        responder: { confirmFacts: customs ? (has("CUSTOMS_RELEASE_IN_PORTAL") ? "CONFIRM" : "CANT_FIND") : has("AIS_DARK_GAP") ? "CONFIRM" : null, controller: "APPROVE", trader: "PURSUE" },
      },
    };
  });
}

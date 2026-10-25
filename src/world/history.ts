// History generator (WORLD §7): 32 closed cases, Jan–Aug 2026, seed MERIDIAN-2026-H1. Deterministic.
import { rng } from "./ais";
import { buildCase, type CaseRecipe, type ExceptionRecipe } from "./caseBuilder";
import { FLEET } from "./company";
import { CARGO_FORM_BY_PARTY, CP_FORM_BY_OWNER, FORMS, TRADE_LANE } from "./forms";
import type { HistoryCase, PatternTag } from "./types";

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
export const HISTORY_SEED = "MERIDIAN-2026-H1";

type Spec = { cargo?: string; patterns?: PatternTag[]; customs?: ExceptionRecipe["customsEvidence"]; waiver?: { cents: number; reason: string } };
// Index → pattern assignment (WORLD §7 planted history patterns). Vessel = FLEET[i % 8].
const SPECS: Record<number, Spec> = {
  0: { cargo: "HANSA", patterns: ["NORDHAVN_CLOSURE_AFTER_DEMURRAGE_COUNTED"] },
  13: { cargo: "HANSA", patterns: ["NORDHAVN_CLOSURE_AFTER_DEMURRAGE_COUNTED"] },
  1: { cargo: "LITORAL", patterns: ["CUSTOMS_RELEASE_IN_PORTAL"], customs: "PORTAL_RELEASE" },
  3: { cargo: "PAMPAS", patterns: ["CUSTOMS_RELEASE_IN_PORTAL"], customs: "PORTAL_RELEASE" },
  4: { cargo: "LITORAL", patterns: ["CUSTOMS_RELEASE_IN_PORTAL"], customs: "PORTAL_RELEASE" },
  9: { cargo: "PAMPAS", patterns: ["CUSTOMS_RELEASE_IN_PORTAL"], customs: "PORTAL_RELEASE" },
  12: { cargo: "PAMPAS", patterns: ["CUSTOMS_RELEASE_OUTSIDE_INTERVAL"], customs: "PORTAL_RELEASE_OUTSIDE" },
  22: { cargo: "LITORAL", patterns: ["CUSTOMS_NO_RELEASE"], customs: "NONE" },
  2: { cargo: "ALNOOR", patterns: ["PREMATURE_NOR"] },
  8: { cargo: "HANSA", patterns: ["PREMATURE_NOR"] },
  15: { cargo: "SAIGONAG", patterns: ["PREMATURE_NOR"] },
  10: { cargo: "ALNOOR", patterns: ["SOF_LOCAL_AS_UTC"] },
  16: { cargo: "HANSA", patterns: ["SOF_LOCAL_AS_UTC"] },
  5: { cargo: "HANSA", patterns: ["SHIFTING_BILLED"] },
  7: { cargo: "ALNOOR", patterns: ["SHIFTING_BILLED"] },
  18: { cargo: "ALNOOR", patterns: ["SHIFTING_BILLED"] },
  21: { cargo: "HANSA", patterns: ["SHIFTING_BILLED"] },
  20: { cargo: "PAMPAS", patterns: ["GOODWILL_WAIVER"], waiver: { cents: 200_000, reason: "Goodwill: Pampas accepted a late nomination" } },
};
const DEFAULT_CARGO: Record<string, string> = { NORDHAVN: "HANSA", THALASSA: "LITORAL", OKEANOS: "ALNOOR", PACCREST: "SAIGONAG", KAIYO: "PAMPAS" };

export function historyRecipes(seed = HISTORY_SEED): CaseRecipe[] {
  const random = rng(seed);
  const pick = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const recipes: CaseRecipe[] = [];
  for (let i = 0; i < 32; i++) {
    const vessel = FLEET[i % 8];
    const spec = SPECS[i] ?? {};
    const cargoCode = spec.cargo ?? DEFAULT_CARGO[vessel.ownerCode];
    const lane = TRADE_LANE[cargoCode];
    const cpForm = FORMS[CP_FORM_BY_OWNER[vessel.ownerCode]];
    const cargoForm = FORMS[CARGO_FORM_BY_PARTY[cargoCode]];
    const patterns = spec.patterns ?? [];
    // Months 1..8: each vessel sails every other month, so a vessel's cases never overlap.
    const month = 1 + 2 * Math.floor(i / 8) + ((i % 8) >= 4 ? 1 : 0);
    const day = pick(3, 16);
    const arrivalAt = Date.UTC(2026, month - 1, day, pick(0, 20), 0);
    const premature = patterns.includes("PREMATURE_NOR");
    const norTenderedAt = premature ? arrivalAt - pick(8, 12) * HOUR : arrivalAt;
    const cpStart = arrivalAt + cpForm.truth.noticeMinutes * MINUTE;

    const exceptions: ExceptionRecipe[] = [];
    let cursor = cpStart + pick(20, 30) * HOUR;
    const place = (kind: ExceptionRecipe["kind"], hours: number, extra: Partial<ExceptionRecipe> = {}) => {
      exceptions.push({ kind, startAt: cursor, endAt: cursor + hours * HOUR, ...extra });
      cursor += hours * HOUR + pick(6, 14) * HOUR;
    };
    if (i % 3 === 0 && !patterns.includes("NORDHAVN_CLOSURE_AFTER_DEMURRAGE_COUNTED")) place("WEATHER", 2 * pick(4, 8));
    if (patterns.includes("SHIFTING_BILLED") || (i % 5 === 0 && lane.operation === "DISCHARGE")) place("SHIFTING", pick(3, 5));
    if (spec.customs) place("CUSTOMS_HOLD", pick(8, 14), { customsEvidence: spec.customs });
    if (patterns.includes("NORDHAVN_CLOSURE_AFTER_DEMURRAGE_COUNTED")) {
      cursor = Math.max(cursor, cpStart + cpForm.truth.laytimeMinutes * MINUTE + pick(10, 20) * HOUR); // after laytime expires
      place("PORT_CLOSURE", 24);
    }
    const exceptionMinutes = exceptions.reduce((sum, exception) => sum + (exception.endAt - exception.startAt) / MINUTE, 0);
    const completionAt = Math.max(cursor, cpStart + (cpForm.truth.laytimeMinutes + exceptionMinutes) * MINUTE) + pick(24, 90) * HOUR;
    recipes.push({
      caseCode: `DC-2026-${String(101 + i * 9).padStart(4, "0")}`,
      voyageCode: `${vessel.code.slice(0, 2)}-26${String(month).padStart(2, "0")}-${i}`,
      vesselCode: vessel.code, portCode: lane.portCode, operation: lane.operation,
      ownerCode: vessel.ownerCode, cargoCode,
      cp: { code: `${cpForm.formCode}/${vessel.code}/H${i}`, formCode: cpForm.formCode, registerTerms: cpForm.register, trueTerms: cpForm.truth },
      cargo: { code: `${cargoForm.formCode}-H${i}`, formCode: cargoForm.formCode, kind: cargoForm.kind as "SALE" | "PURCHASE", terms: cargoForm.truth },
      arrivalAt, norTenderedAt, completionAt, exceptions,
      plants: { sofLocalAsUtc: patterns.includes("SOF_LOCAL_AS_UTC"), shiftingBilled: patterns.includes("SHIFTING_BILLED"), adminFeeCents: i % 4 === 1 ? 15_000 : undefined },
      invoiceReceivedAt: completionAt + pick(10, 25) * DAY,
      invoiceNo: `${vessel.ownerCode.slice(0, 2)}-${String(month).padStart(2, "0")}${String(i).padStart(2, "0")}`,
      waiver: spec.waiver,
      patterns,
      seed: `${seed}:${i}`,
    });
  }
  return recipes;
}

export function generateHistory(seed = HISTORY_SEED): HistoryCase[] {
  return historyRecipes(seed).map(buildCase);
}

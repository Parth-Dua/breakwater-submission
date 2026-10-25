// Contract forms used by history, en-route voyages and the scoreboard. Register terms are what Legal entered;
// true terms are the signed text. Only NORDHAVN-CP-2019 differs (cl. 8 proviso omitted; WORLD §2).
import { ALNOOR_SC_0611, HANSA_SC_0917, LITORAL_PC_0802, NORDHAVN_CP_2019, NORDHAVN_CP_2019_TRUE, OKEANOS_CP_2020, THALASSA_CP_2021 } from "./contracts";
import type { ContractTerms, TreatmentRule } from "./types";

const rule = (treatment: TreatmentRule["treatment"], clause: string, requiresEvidence?: TreatmentRule["requiresEvidence"]): TreatmentRule =>
  requiresEvidence ? { treatment, clause, requiresEvidence } : { treatment, clause };

const PACCREST_CP_2022: ContractTerms = {
  noticeMinutes: 360, laytimeMinutes: 4320, deemedNorOnArrival: true, ratePerHourCents: 80_000,
  treatments: { SHIFTING: rule("EXCLUDE", "6"), PORT_CLOSURE: rule("HALF", "9"), WEATHER: rule("HALF", "9"), CUSTOMS_HOLD: rule("COUNT", "10") },
  exceptionsApplyOnDemurrage: true, timeBar: { days: 90, from: "COMPLETION", requires: ["OWNER_INVOICE", "SOF"] },
};
// KAIYO's register correctly records "once on demurrage, always on demurrage" (exceptions stop applying).
const KAIYO_CP_2021: ContractTerms = {
  noticeMinutes: 360, laytimeMinutes: 4320, deemedNorOnArrival: true, ratePerHourCents: 70_000,
  treatments: { SHIFTING: rule("EXCLUDE", "7"), PORT_CLOSURE: rule("HALF", "8"), WEATHER: rule("HALF", "8"), CUSTOMS_HOLD: rule("COUNT", "9") },
  exceptionsApplyOnDemurrage: false, timeBar: { days: 90, from: "COMPLETION", requires: ["OWNER_INVOICE", "SOF"] },
};
const SAIGONAG_SC: ContractTerms = {
  noticeMinutes: 720, laytimeMinutes: 4320, deemedNorOnArrival: true, ratePerHourCents: 70_000,
  treatments: { SHIFTING: rule("EXCLUDE", "11"), PORT_CLOSURE: rule("EXCLUDE", "14"), WEATHER: rule("EXCLUDE", "14"), CUSTOMS_HOLD: rule("COUNT", "12") },
  exceptionsApplyOnDemurrage: true, timeBar: { days: 30, from: "COMPLETION", requires: ["SOF", "NOR"] },
};
const PAMPAS_PC: ContractTerms = {
  noticeMinutes: 360, laytimeMinutes: 5760, deemedNorOnArrival: true, ratePerHourCents: 60_000,
  treatments: { SHIFTING: rule("EXCLUDE", "10"), PORT_CLOSURE: rule("EXCLUDE", "13"), WEATHER: rule("EXCLUDE", "13"), CUSTOMS_HOLD: rule("COUNT", "11", ["CUSTOMS_RELEASE"]) },
  exceptionsApplyOnDemurrage: true, timeBar: { days: 45, from: "COMPLETION", requires: ["SOF", "NOR"] },
};

export type FormDef = { formCode: string; kind: "CHARTER_PARTY" | "SALE" | "PURCHASE"; counterpartyCode: string; register: ContractTerms; truth: ContractTerms; documentCode: string };

export const FORMS: Record<string, FormDef> = {
  "NORDHAVN-CP-2019": { formCode: "NORDHAVN-CP-2019", kind: "CHARTER_PARTY", counterpartyCode: "NORDHAVN", register: NORDHAVN_CP_2019, truth: NORDHAVN_CP_2019_TRUE, documentCode: "DOC-CP-NORDHAVN-2019" },
  "THALASSA-CP-2021": { formCode: "THALASSA-CP-2021", kind: "CHARTER_PARTY", counterpartyCode: "THALASSA", register: THALASSA_CP_2021, truth: THALASSA_CP_2021, documentCode: "DOC-CP-THALASSA-2021" },
  "OKEANOS-CP-2020": { formCode: "OKEANOS-CP-2020", kind: "CHARTER_PARTY", counterpartyCode: "OKEANOS", register: OKEANOS_CP_2020, truth: OKEANOS_CP_2020, documentCode: "DOC-CP-OKEANOS-2020" },
  "PACCREST-CP-2022": { formCode: "PACCREST-CP-2022", kind: "CHARTER_PARTY", counterpartyCode: "PACCREST", register: PACCREST_CP_2022, truth: PACCREST_CP_2022, documentCode: "DOC-CP-PACCREST-2022" },
  "KAIYO-CP-2021": { formCode: "KAIYO-CP-2021", kind: "CHARTER_PARTY", counterpartyCode: "KAIYO", register: KAIYO_CP_2021, truth: KAIYO_CP_2021, documentCode: "DOC-CP-KAIYO-2021" },
  "HANSA-SC": { formCode: "HANSA-SC", kind: "SALE", counterpartyCode: "HANSA", register: HANSA_SC_0917, truth: HANSA_SC_0917, documentCode: "DOC-SC-HANSA-0917" },
  "ALNOOR-SC": { formCode: "ALNOOR-SC", kind: "SALE", counterpartyCode: "ALNOOR", register: ALNOOR_SC_0611, truth: ALNOOR_SC_0611, documentCode: "DOC-SC-ALNOOR-0611" },
  "SAIGONAG-SC": { formCode: "SAIGONAG-SC", kind: "SALE", counterpartyCode: "SAIGONAG", register: SAIGONAG_SC, truth: SAIGONAG_SC, documentCode: "DOC-SC-SAIGONAG" },
  "LITORAL-PC": { formCode: "LITORAL-PC", kind: "PURCHASE", counterpartyCode: "LITORAL", register: LITORAL_PC_0802, truth: LITORAL_PC_0802, documentCode: "DOC-PC-LITORAL-0802" },
  "PAMPAS-PC": { formCode: "PAMPAS-PC", kind: "PURCHASE", counterpartyCode: "PAMPAS", register: PAMPAS_PC, truth: PAMPAS_PC, documentCode: "DOC-PC-PAMPAS" },
};

export const CP_FORM_BY_OWNER: Record<string, string> = { NORDHAVN: "NORDHAVN-CP-2019", THALASSA: "THALASSA-CP-2021", OKEANOS: "OKEANOS-CP-2020", PACCREST: "PACCREST-CP-2022", KAIYO: "KAIYO-CP-2021" };
export const CARGO_FORM_BY_PARTY: Record<string, string> = { HANSA: "HANSA-SC", ALNOOR: "ALNOOR-SC", SAIGONAG: "SAIGONAG-SC", LITORAL: "LITORAL-PC", PAMPAS: "PAMPAS-PC" };
/** Where each cargo counterparty trades (discharge for buyers, load for sellers). */
export const TRADE_LANE: Record<string, { portCode: string; operation: "LOAD" | "DISCHARGE" }> = {
  HANSA: { portCode: "NLRTM", operation: "DISCHARGE" }, ALNOOR: { portCode: "EGALY", operation: "DISCHARGE" }, SAIGONAG: { portCode: "VNCMP", operation: "DISCHARGE" },
  LITORAL: { portCode: "BRSSZ", operation: "LOAD" }, PAMPAS: { portCode: "ARROS", operation: "LOAD" },
};

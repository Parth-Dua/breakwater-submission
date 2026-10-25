// WORLD §3: contract register values. These are what Legal entered; NORDHAVN-CP-2019 cl. 8 deliberately
// omits the proviso "unless the vessel is already on demurrage" (WORLD §2, planted data error).
import type { ContractDef, ContractTerms, TreatmentRule } from "./types";

const rule = (treatment: TreatmentRule["treatment"], clause: string, requiresEvidence?: TreatmentRule["requiresEvidence"]): TreatmentRule =>
  requiresEvidence ? { treatment, clause, requiresEvidence } : { treatment, clause };
const perHour = (centsPerDay: number) => centsPerDay / 24;

export const NORDHAVN_CP_2019: ContractTerms = {
  noticeMinutes: 360, laytimeMinutes: 4320, deemedNorOnArrival: true, ratePerHourCents: perHour(2_400_000),
  treatments: { SHIFTING: rule("EXCLUDE", "7"), PORT_CLOSURE: rule("HALF", "8"), WEATHER: rule("HALF", "8"), CUSTOMS_HOLD: rule("COUNT", "9") },
  exceptionsApplyOnDemurrage: true, // register value; the true clause says false (proviso omitted)
  timeBar: { days: 90, from: "COMPLETION", requires: ["OWNER_INVOICE", "SOF"] },
};

export const HANSA_SC_0917: ContractTerms = {
  noticeMinutes: 720, laytimeMinutes: 3600, deemedNorOnArrival: true, ratePerHourCents: perHour(2_160_000),
  treatments: { SHIFTING: rule("EXCLUDE", "11"), PORT_CLOSURE: rule("EXCLUDE", "14"), WEATHER: rule("EXCLUDE", "14"), CUSTOMS_HOLD: rule("COUNT", "12") },
  exceptionsApplyOnDemurrage: true,
  timeBar: { days: 30, from: "COMPLETION", requires: ["SOF", "NOR"] },
};

export const THALASSA_CP_2021: ContractTerms = {
  noticeMinutes: 360, laytimeMinutes: 5760, deemedNorOnArrival: true, ratePerHourCents: perHour(1_800_000),
  treatments: { SHIFTING: rule("EXCLUDE", "7"), PORT_CLOSURE: rule("HALF", "8"), WEATHER: rule("HALF", "8"), CUSTOMS_HOLD: rule("COUNT", "9") },
  exceptionsApplyOnDemurrage: true,
  timeBar: { days: 90, from: "COMPLETION", requires: ["OWNER_INVOICE", "SOF"] },
};

export const LITORAL_PC_0802: ContractTerms = {
  noticeMinutes: 360, laytimeMinutes: 6480, deemedNorOnArrival: true, ratePerHourCents: perHour(1_800_000),
  treatments: { SHIFTING: rule("EXCLUDE", "10"), PORT_CLOSURE: rule("EXCLUDE", "13"), WEATHER: rule("EXCLUDE", "13"), CUSTOMS_HOLD: rule("COUNT", "11", ["CUSTOMS_RELEASE"]) },
  exceptionsApplyOnDemurrage: true,
  timeBar: { days: 45, from: "COMPLETION", requires: ["SOF", "NOR"] },
};

// Halden Star (WORLD §7, seed HALDEN-2026-10): Okeanos CP, Al-Noor sale.
export const OKEANOS_CP_2020: ContractTerms = {
  noticeMinutes: 360, laytimeMinutes: 4320, deemedNorOnArrival: true, ratePerHourCents: perHour(1_500_000),
  treatments: { SHIFTING: rule("EXCLUDE", "7"), PORT_CLOSURE: rule("HALF", "8"), WEATHER: rule("HALF", "8"), CUSTOMS_HOLD: rule("COUNT", "9") },
  exceptionsApplyOnDemurrage: true,
  timeBar: { days: 90, from: "COMPLETION", requires: ["OWNER_INVOICE", "SOF"] },
};
export const ALNOOR_SC_0611: ContractTerms = {
  noticeMinutes: 720, laytimeMinutes: 3600, deemedNorOnArrival: true, ratePerHourCents: perHour(1_200_000),
  treatments: { SHIFTING: rule("EXCLUDE", "11"), PORT_CLOSURE: rule("EXCLUDE", "14"), WEATHER: rule("EXCLUDE", "14"), CUSTOMS_HOLD: rule("COUNT", "12") },
  exceptionsApplyOnDemurrage: true,
  timeBar: { days: 30, from: "COMPLETION", requires: ["SOF", "NOR"] },
};

/** The clause the register omitted (used by history truth for NORDHAVN-CP-2019 and by WORLD answer-key tests). */
export const NORDHAVN_CP_2019_TRUE: ContractTerms = { ...NORDHAVN_CP_2019, exceptionsApplyOnDemurrage: false };

export const ACTIVE_CONTRACTS: ContractDef[] = [
  { code: "NORDHAVN-CP-2019/ASTER_VALE", kind: "CHARTER_PARTY", formCode: "NORDHAVN-CP-2019", counterpartyCode: "NORDHAVN", terms: NORDHAVN_CP_2019, documentCode: "DOC-CP-NORDHAVN-2019" },
  { code: "HANSA-SC-0917", kind: "SALE", formCode: "HANSA-SC", counterpartyCode: "HANSA", terms: HANSA_SC_0917, documentCode: "DOC-SC-HANSA-0917" },
  { code: "THALASSA-CP-2021/KESTREL", kind: "CHARTER_PARTY", formCode: "THALASSA-CP-2021", counterpartyCode: "THALASSA", terms: THALASSA_CP_2021, documentCode: "DOC-CP-THALASSA-2021" },
  { code: "LITORAL-PC-0802", kind: "PURCHASE", formCode: "LITORAL-PC", counterpartyCode: "LITORAL", terms: LITORAL_PC_0802, documentCode: "DOC-PC-LITORAL-0802" },
  { code: "OKEANOS-CP-2020/HALDEN_STAR", kind: "CHARTER_PARTY", formCode: "OKEANOS-CP-2020", counterpartyCode: "OKEANOS", terms: OKEANOS_CP_2020, documentCode: "DOC-CP-OKEANOS-2020" },
  { code: "ALNOOR-SC-0611", kind: "SALE", formCode: "ALNOOR-SC", counterpartyCode: "ALNOOR", terms: ALNOOR_SC_0611, documentCode: "DOC-SC-ALNOOR-0611" },
];

// CONTRACTS §9 postconditions.ts — what each agent task must have produced. Pure; the runtime builds the snapshots.
export type TaskKind = "FLEET_SCAN" | "AIS_UPDATE" | "DOCUMENT_RECEIVED" | "PORT_NOTICE" | "MONTH_END" | "DEADLINE_CHECK" | "ASK_ANSWERED";

export type CaseSnapshot = {
  factKeys: string[];
  intervals: { kind: string; verified: boolean; hasOpenAsk: boolean }[];
  statementVersions: { PAYABLE?: number; RECOVERABLE?: number };
  documentKind?: "NOR" | "SOF" | "OWNER_INVOICE" | string;
  sof?: { rows: number; mapped: number };
  closureRecorded?: boolean;
  reconciliation?: boolean;
  apPosted?: boolean;
  openAskKinds: string[];
  filingExists?: boolean;
  recoveryRequired?: boolean;
  askApplied?: boolean;
  aisBatch?: { entryDetected: boolean; entryRecorded: boolean; movements: number; movementsRecorded: number };
  monthEnd?: { candidateCaseIds: string[]; handledCaseIds: string[] };
  fleetScan?: { candidateVesselIds: string[]; handledVesselIds: string[] };
};

const missingAll = (want: string[], have: string[]) => want.filter(item => !have.includes(item));

export function checkPostconditions(kind: TaskKind, before: CaseSnapshot, after: CaseSnapshot): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  switch (kind) {
    case "FLEET_SCAN":
      if (after.fleetScan) missing.push(...missingAll(after.fleetScan.candidateVesselIds, after.fleetScan.handledVesselIds).map(id => `vessel ${id} neither opened nor marked not affected`));
      break;
    case "AIS_UPDATE":
      if (after.aisBatch?.entryDetected && !after.aisBatch.entryRecorded) missing.push("ARRIVAL_IN_PORT_LIMITS fact");
      if (after.aisBatch && after.aisBatch.movementsRecorded < after.aisBatch.movements) missing.push("movement intervals");
      if (after.aisBatch?.entryRecorded && after.factKeys.includes("NOR_TENDERED")) missing.push(...missingAll(["LAYTIME_START_PAYABLE", "LAYTIME_START_RECOVERABLE"], after.factKeys));
      break;
    case "DOCUMENT_RECEIVED":
      // Laytime starts are required once arrival is known; a NOR tendered before arrival is deemed tendered on arrival.
      if (after.documentKind === "NOR") missing.push(...missingAll(["NOR_TENDERED", "NOR_VALIDITY", ...(after.factKeys.includes("ARRIVAL_IN_PORT_LIMITS") ? ["LAYTIME_START_PAYABLE", "LAYTIME_START_RECOVERABLE"] : [])], after.factKeys));
      if (after.documentKind === "SOF") {
        if (!after.factKeys.includes("COMPLETION")) missing.push("COMPLETION");
        if (after.sof && after.sof.mapped < after.sof.rows) missing.push(`SOF rows mapped ${after.sof.mapped}/${after.sof.rows}`);
        for (const interval of after.intervals) if (interval.kind === "CUSTOMS_HOLD" && !interval.verified && !interval.hasOpenAsk) missing.push("customs hold neither verified nor asked");
        if (!((after.statementVersions.PAYABLE ?? 0) > (before.statementVersions.PAYABLE ?? 0))) missing.push("payable statement recomputed");
        if (after.recoveryRequired && !after.filingExists && !after.openAskKinds.some(kind => ["CONFIRM_FACT", "COMMERCIAL_DECISION"].includes(kind))) missing.push("recovery filing or routed ask");
        if (!((after.statementVersions.RECOVERABLE ?? 0) > (before.statementVersions.RECOVERABLE ?? 0))) missing.push("recoverable statement recomputed");
      }
      if (after.documentKind === "OWNER_INVOICE") {
        if (!after.reconciliation) missing.push("invoice reconciliation");
        if (!after.apPosted && !after.openAskKinds.includes("PAYMENT_APPROVAL")) missing.push("AP posted or PAYMENT_APPROVAL ask");
      }
      break;
    case "PORT_NOTICE":
      if (after.documentKind === "PORT_CLOSURE" && !after.closureRecorded) missing.push("verified closure notice interval");
      break;
    case "MONTH_END":
      if (after.monthEnd) missing.push(...missingAll(after.monthEnd.candidateCaseIds, after.monthEnd.handledCaseIds).map(id => `accrual for case ${id}`));
      break;
    case "ASK_ANSWERED":
      if (!after.askApplied) missing.push("answer applied");
      break;
    case "DEADLINE_CHECK":
      if (!after.filingExists) missing.push("recovery filing or protective notice");
      break;
  }
  return { ok: missing.length === 0, missing };
}

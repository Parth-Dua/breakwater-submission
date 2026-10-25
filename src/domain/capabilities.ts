// CONTRACTS §6 / ARCHITECTURE §6 — least-privilege capabilities. Pure.
import type { DocKind } from "../world/types";

export type SourceSystem = "MAILBOX" | "DOC_STORE" | "CONTRACT_REGISTER" | "AIS" | "PORT_DATA" | "CUSTOMS_PORTAL" | "LEDGER" | "COUNTERPARTY_MASTER" | "POLICY_REGISTER";
export type CapabilityScope = "CASE_VESSEL" | "CASE_VESSEL_AND_INTERVAL" | "CASE_COUNTERPARTIES" | "GLOBAL_READONLY";
export type Capability = {
  id: string; system: SourceSystem; access: "READ"; scope: CapabilityScope; docKinds?: DocKind[];
  grantedBy: "BASE" | "ROLE" | { memoryItemId: string; version: number };
};

/** What a single source read touches. */
export type SourceRequest = { system: SourceSystem; vesselId?: string; portId?: string; docKind?: DocKind; contractId?: string; counterpartyId?: string; interval?: { from: number; to: number } };
/** The case a run is working on: everything a scoped capability can reach. */
export type CaseContext = { voyageId?: string; vesselId: string; portId: string; contractIds: string[]; counterpartyIds: string[]; window: { from: number; to: number } };

export const OPERATIONAL_DOC_KINDS: DocKind[] = ["NOR", "SOF", "OWNER_INVOICE", "PORT_ADVISORY", "PORT_CLOSURE", "CUSTOMS_HOLD", "CUSTOMS_RELEASE", "COUNTERPARTY_REPLY", "LAYTIME_STATEMENT", "RECOVERY_CLAIM", "DISPUTE_LETTER"];

/** ARCHITECTURE §6 base agent grants. CUSTOMS_PORTAL is absent until an approved procedure grants it. */
export function baseAgentCapabilities(): Capability[] {
  const base = (system: SourceSystem, scope: CapabilityScope, docKinds?: DocKind[]): Capability =>
    ({ id: `base:${system}`, system, access: "READ", scope, grantedBy: "BASE", ...(docKinds ? { docKinds } : {}) });
  return [
    base("MAILBOX", "CASE_VESSEL"),
    base("DOC_STORE", "CASE_VESSEL", OPERATIONAL_DOC_KINDS),
    base("CONTRACT_REGISTER", "CASE_COUNTERPARTIES"),
    base("AIS", "CASE_VESSEL"),
    base("PORT_DATA", "GLOBAL_READONLY"),
    base("LEDGER", "CASE_COUNTERPARTIES"),
    base("COUNTERPARTY_MASTER", "GLOBAL_READONLY"),
    base("POLICY_REGISTER", "GLOBAL_READONLY"),
  ];
}

/** Human role grants (WORLD §2): Ops can read the customs portal and all document kinds for the case vessel. */
export function roleCapabilities(role: "ops" | "controller" | "trader"): Capability[] {
  const grant = (system: SourceSystem, scope: CapabilityScope): Capability => ({ id: `role:${role}:${system}`, system, access: "READ", scope, grantedBy: "ROLE" });
  const all: SourceSystem[] = ["MAILBOX", "DOC_STORE", "CONTRACT_REGISTER", "AIS", "PORT_DATA", "CUSTOMS_PORTAL", "LEDGER", "COUNTERPARTY_MASTER", "POLICY_REGISTER"];
  const systems: SourceSystem[] = role === "ops" ? ["MAILBOX", "DOC_STORE", "AIS", "PORT_DATA", "CUSTOMS_PORTAL"] : role === "trader" ? ["MAILBOX", "CONTRACT_REGISTER", "LEDGER", "COUNTERPARTY_MASTER"] : all;
  return systems.map(system => grant(system, system === "PORT_DATA" || system === "COUNTERPARTY_MASTER" || system === "POLICY_REGISTER" ? "GLOBAL_READONLY" : "CASE_VESSEL"));
}

export function capabilityAllows(capability: Capability, request: SourceRequest, context: CaseContext): boolean {
  if (capability.system !== request.system || capability.access !== "READ") return false;
  if (capability.docKinds && (!request.docKind || !capability.docKinds.includes(request.docKind))) return false;
  switch (capability.scope) {
    case "GLOBAL_READONLY": return true;
    case "CASE_VESSEL":
      if (request.vesselId !== undefined) return request.vesselId === context.vesselId;
      if (request.contractId !== undefined) return context.contractIds.includes(request.contractId);
      return request.portId === undefined || request.portId === context.portId; // port-level documents: the case's port only
    case "CASE_VESSEL_AND_INTERVAL": {
      if (request.vesselId !== context.vesselId || !request.interval) return false;
      return request.interval.from < context.window.to && request.interval.to > context.window.from;
    }
    case "CASE_COUNTERPARTIES":
      return (request.contractId !== undefined && context.contractIds.includes(request.contractId))
        || (request.counterpartyId !== undefined && context.counterpartyIds.includes(request.counterpartyId))
        || (request.vesselId !== undefined && request.vesselId === context.vesselId);
  }
}

export function findCapability(capabilities: Capability[], request: SourceRequest, context: CaseContext): Capability | undefined {
  return capabilities.find(capability => capabilityAllows(capability, request, context));
}

/** An ACTIVE procedure's grants, already matched to the case by the procedure matcher (LEARNING §7, V10). */
export type ProcedureGrant = { memoryItemId: string; version: number; grants: { system: SourceSystem; scope: CapabilityScope }[] };

/** CONTRACTS §5: base grants ∪ grants from matching ACTIVE procedures. */
export function resolveCapabilities(matchingProcedures: ProcedureGrant[]): Capability[] {
  const granted = matchingProcedures.flatMap(procedure => procedure.grants.map(grant => ({
    id: `memory:${procedure.memoryItemId}:v${procedure.version}:${grant.system}`, system: grant.system, access: "READ" as const, scope: grant.scope,
    grantedBy: { memoryItemId: procedure.memoryItemId, version: procedure.version },
  })));
  return [...baseAgentCapabilities(), ...granted];
}

/** Agent tool → the system it reads (CONTRACTS §10.3). Tools not listed need no source capability (engine/gateway tools). */
export const TOOL_SYSTEMS: Record<string, SourceSystem[]> = {
  search_mailbox: ["MAILBOX"], read_document: ["DOC_STORE"], get_ais: ["AIS"], check_nor: ["AIS", "PORT_DATA"],
  convert_local_times: ["PORT_DATA"], search_customs_portal: ["CUSTOMS_PORTAL"], verify_hold: ["CUSTOMS_PORTAL"], get_contract_terms: ["CONTRACT_REGISTER"],
};

/** Whether a tool may be offered at all for this run (tools whose system has no capability are hidden from the model). */
export function toolOffered(capabilities: Capability[], tool: string): boolean {
  const systems = TOOL_SYSTEMS[tool];
  return !systems || systems.every(system => capabilities.some(capability => capability.system === system));
}

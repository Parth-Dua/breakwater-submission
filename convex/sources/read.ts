// Systems of record (WORLD §2), read through capabilities (ARCHITECTURE §6). Every read is scoped to the case
// and to sim time: nothing is visible before it has "arrived". Denials throw CAPABILITY_DENIED (callers audit them).
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { fail } from "../lib/errors";
import { findCapability, type Capability, type CaseContext, type SourceRequest } from "../../src/domain/capabilities";
import type { DocKind } from "../../src/world/types";

const DAY = 86_400_000;

export type ReadScope = { ns: string; capabilities: Capability[]; context: CaseContext; simNow: number };

function require(scope: ReadScope, request: SourceRequest): Capability {
  const capability = findCapability(scope.capabilities, request, scope.context);
  if (!capability) fail("CAPABILITY_DENIED", `No access to ${request.system}${request.docKind ? ` (${request.docKind})` : ""}`);
  return capability;
}

/** Case context from a voyage: vessel, port, both contracts and their counterparties; window from 3 days before ETA. */
export async function caseContextForVoyage(ctx: QueryCtx, voyageId: Id<"voyages">, horizonAt: number): Promise<CaseContext> {
  const voyage = await ctx.db.get(voyageId);
  if (!voyage) throw new Error("voyage not found");
  const charter = await ctx.db.get(voyage.charterId);
  const cargo = await ctx.db.get(voyage.cargoContractId);
  return {
    voyageId, vesselId: voyage.vesselId, portId: voyage.portId,
    contractIds: [voyage.charterId, voyage.cargoContractId],
    counterpartyIds: [charter?.counterpartyId, cargo?.counterpartyId].filter((id): id is Id<"counterparties"> => Boolean(id)),
    window: { from: voyage.eta - 3 * DAY, to: Math.max(horizonAt, voyage.eta + 3 * DAY) },
  };
}

export async function searchMailbox(ctx: QueryCtx, scope: ReadScope, params: { vesselId: Id<"vessels">; kinds?: DocKind[]; since?: number }) {
  const capability = require(scope, { system: "MAILBOX", vesselId: params.vesselId });
  const vessel = await ctx.db.get(params.vesselId);
  const messages = await ctx.db.query("mailMessages").withIndex("by_received", q => q.eq("ns", scope.ns).lte("receivedAt", scope.simNow)).collect();
  const results = [];
  for (const message of messages) {
    if (message.vesselImo !== vessel?.imo || (params.since !== undefined && message.receivedAt < params.since)) continue;
    const document = message.documentId ? await ctx.db.get(message.documentId) : null;
    if (document?.voyageId && document.voyageId !== scope.context.voyageId) continue;
    if (params.kinds && (!document || !params.kinds.includes(document.kind))) continue;
    results.push({ messageId: message._id, from: message.from, subject: message.subject, receivedAt: message.receivedAt, documentCode: document?.code, documentKind: document?.kind });
  }
  return { capabilityId: capability.id, results };
}

export async function getDocument(ctx: QueryCtx, scope: ReadScope, code: string): Promise<{ capabilityId: string; document: Doc<"documents"> }> {
  const document = await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", scope.ns).eq("code", code)).unique();
  if (!document || (document.receivedAt !== undefined && document.receivedAt > scope.simNow)) fail("MISSING_EVIDENCE", `Document ${code} not available`);
  if (document.voyageId && document.voyageId !== scope.context.voyageId) fail("CAPABILITY_DENIED", "Document belongs to another voyage");
  const isContract = document.kind === "CHARTER_PARTY" || document.kind === "SALE_CONTRACT" || document.kind === "PURCHASE_CONTRACT";
  const contract = isContract ? await ctx.db.query("contracts").withIndex("by_ns", q => q.eq("ns", scope.ns)).filter(q => q.eq(q.field("documentId"), document._id)).first() : null;
  const capability = require(scope, {
    system: document.system,
    docKind: document.kind,
    ...(document.vesselId ? { vesselId: document.vesselId } : {}),
    ...(document.portId && !document.vesselId ? { portId: document.portId } : {}),
    ...(contract ? { contractId: contract._id } : {}),
    // Portal records are time-scoped: the document's own timestamp is the interval it covers.
    ...(document.system === "CUSTOMS_PORTAL" ? { interval: { from: document.receivedAt ?? 0, to: (document.receivedAt ?? 0) + 60_000 } } : {}),
  });
  return { capabilityId: capability.id, document };
}

export async function searchCustomsPortal(ctx: QueryCtx, scope: ReadScope, params: { portId: Id<"ports">; vesselId: Id<"vessels">; from: number; to: number }) {
  const capability = require(scope, { system: "CUSTOMS_PORTAL", vesselId: params.vesselId, interval: { from: params.from, to: params.to } });
  const records = await ctx.db.query("customsRecords").withIndex("by_port_vessel", q => q.eq("ns", scope.ns).eq("portId", params.portId).eq("vesselId", params.vesselId)).collect();
  const results = [];
  for (const record of records) {
    if (record.startAt > scope.simNow) continue;
    const document = await ctx.db.get(record.documentId);
    if (document?.receivedAt !== undefined && document.receivedAt > scope.simNow) continue;
    if (document?.voyageId && document.voyageId !== scope.context.voyageId) continue;
    if ((record.endAt ?? record.startAt) < params.from || record.startAt > params.to) continue;
    results.push({ kind: record.kind, startAt: record.startAt, endAt: record.endAt, documentCode: document?.code });
  }
  return { capabilityId: capability.id, results };
}

export async function aisWindow(ctx: QueryCtx, scope: ReadScope, params: { vesselId: Id<"vessels">; from: number; to: number }) {
  const capability = require(scope, { system: "AIS", vesselId: params.vesselId });
  const to = Math.min(params.to, scope.simNow);
  const points = await ctx.db.query("aisPoints").withIndex("by_vessel_at", q => q.eq("ns", scope.ns).eq("vesselId", params.vesselId).gte("at", params.from).lte("at", to)).collect();
  return { capabilityId: capability.id, points: points.filter(point=>!point.voyageId||point.voyageId===scope.context.voyageId).map(({ at, lon, lat, sogKn, cogDeg }) => ({ at, lon, lat, sogKn, cogDeg })) };
}

export async function contractTerms(ctx: QueryCtx, scope: ReadScope, contractId: Id<"contracts">) {
  const capability = require(scope, { system: "CONTRACT_REGISTER", contractId });
  const contract = await ctx.db.get(contractId);
  if (!contract) fail("MISSING_EVIDENCE", "Contract not found");
  return { capabilityId: capability.id, contract };
}

export async function portData(ctx: QueryCtx, scope: ReadScope, portId: Id<"ports">) {
  const capability = require(scope, { system: "PORT_DATA" });
  return { capabilityId: capability.id, port: await ctx.db.get(portId) };
}

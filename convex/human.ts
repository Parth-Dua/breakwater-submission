import { canonicalJson } from "../src/domain/canonical";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requirePersona, type ActingPersona } from "./lib/persona";
import { getSimNow } from "./lib/clock";
import { fail } from "./lib/errors";
import { loadCase } from "./agent/state";
import { getDocument, caseContextForVoyage, type ReadScope } from "./sources/read";
import { roleCapabilities } from "../src/domain/capabilities";
import type { EvidenceRef } from "../src/domain/laytime";

export const automationArg = { automation: v.optional(v.boolean()) };
export const humanOrigin = (automation?: boolean) => automation ? "AUTOMATED_TEST" as const : "HUMAN" as const;
export async function askForHuman(ctx: QueryCtx, askCode: string, kinds?: Doc<"asks">["kind"][]) {
  const acting = await requirePersona(ctx, ["ops", "controller", "trader"]);
  const ask = await ctx.db.query("asks").withIndex("by_code", q => q.eq("ns", "demo").eq("code", askCode)).unique();
  if (!ask || ask.role !== acting.persona.role || kinds && !kinds.includes(ask.kind)) fail("WRONG_ROLE", "This work belongs to another role");
  if (ask.status !== "OPEN") fail("STALE_VERSION", "This ask was already answered");
  return { ask, acting, bundle: await loadCase(ctx, ask.caseId) };
}
export async function eventsFor(ctx: QueryCtx, ask: Doc<"asks">) {
  return ctx.db.query("humanEvents").withIndex("by_ask_seq", q => q.eq("ns", ask.ns).eq("askId", ask._id)).collect();
}
export async function recordHuman(ctx: MutationCtx, ask: Doc<"asks">, acting: ActingPersona, type: Doc<"humanEvents">["type"], payload: Record<string, unknown>, automation?: boolean) {
  const events = await eventsFor(ctx, ask);
  return ctx.db.insert("humanEvents", { ns: ask.ns, origin: humanOrigin(automation), askId: ask._id, caseId: ask.caseId, personaId: acting.persona._id, role: acting.persona.role, type, payload, simAt: await getSimNow(ctx, ask.ns), wallAt: Date.now(), seq: (events.at(-1)?.seq ?? 0) + 1 });
}
export async function startHuman(ctx: MutationCtx, ask: Doc<"asks">, acting: ActingPersona, automation?: boolean) {
  if (!(await eventsFor(ctx, ask)).some(event => event.type === "WORK_STARTED" && event.personaId === acting.persona._id)) await recordHuman(ctx, ask, acting, "WORK_STARTED", {}, automation);
}
export async function humanScope(ctx: QueryCtx, caseId: Doc<"asks">["caseId"], acting: ActingPersona): Promise<ReadScope> {
  const bundle = await loadCase(ctx, caseId), simNow = await getSimNow(ctx, bundle.case.ns);
  if (!["ops", "controller", "trader"].includes(acting.persona.role)) fail("WRONG_ROLE", "Choose a work role");
  return { ns: bundle.case.ns, simNow, capabilities: roleCapabilities(acting.persona.role as "ops" | "controller" | "trader"), context: await caseContextForVoyage(ctx, bundle.voyage._id, simNow) };
}
export function linkedEvidence(events: Doc<"humanEvents">[], personaId?: string): EvidenceRef[] {
  const linked = new Map<string, EvidenceRef>();
  for (const event of events.filter(event => !personaId || event.personaId === personaId)) {
    const payload = event.payload as { evidence?: EvidenceRef };
    if (!payload.evidence) continue;
    const key = canonicalJson(payload.evidence);
    if (event.type === "EVIDENCE_LINKED") linked.set(key, payload.evidence);
    else if (event.type === "EVIDENCE_UNLINKED") linked.delete(key);
  }
  return [...linked.values()];
}
export async function validatedDocumentEvidence(ctx: QueryCtx, ask: Doc<"asks">, acting: ActingPersona, ref: EvidenceRef) {
  if (ref.kind !== "DOC") fail("MISSING_EVIDENCE", "Link a source document");
  const { document } = await getDocument(ctx, await humanScope(ctx, ask.caseId, acting), ref.documentId);
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  if (ref.quote && !normalize(document.textLayer).includes(normalize(ref.quote))) fail("QUOTE_NOT_FOUND", "The quote is not in this document");
  if (ref.page !== undefined && (!Number.isSafeInteger(ref.page) || ref.page < 1)) fail("NOT_PERMITTED", "Invalid page");
  const events = await eventsFor(ctx, ask);
  if (!events.some(event => event.personaId === acting.persona._id && event.type === "DOCUMENT_OPENED" && (event.payload as { documentCode?: string }).documentCode === document.code)) fail("MISSING_EVIDENCE", "Open the document before linking it");
  return document;
}

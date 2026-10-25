import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { fail } from "../lib/errors";
import { requirePersona } from "../lib/persona";
import { caseByCode } from "../agent/state";
import { automationArg, humanScope, recordHuman, startHuman, eventsFor } from "../human";
import { getDocument, searchCustomsPortal, searchMailbox } from "./read";

async function opsWork(ctx: Parameters<typeof requirePersona>[0], code: string) {
  const acting = await requirePersona(ctx, ["ops"]), item = await caseByCode(ctx, "demo", code);
  if (!item) fail("NOT_PERMITTED", "Case not found");
  const ask = (await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", "demo").eq("caseId", item._id)).collect()).find(ask => ask.status === "OPEN" && ask.kind === "CONFIRM_FACT" && ask.role === "ops");
  if (!ask) fail("STALE_VERSION", "No open Ops work");
  return { acting, ask, scope: await humanScope(ctx, item._id, acting) };
}
export const search = mutation({
  args: { caseCode: v.string(), system: v.union(v.literal("MAILBOX"), v.literal("CUSTOMS_PORTAL"), v.literal("DOC_STORE")), query: v.string(), ...automationArg }, returns: v.any(),
  handler: async (ctx, { caseCode, system, query, automation }) => {
    const { acting, ask, scope } = await opsWork(ctx, caseCode);
    if (!query.trim() || query.length > 160) fail("NOT_PERMITTED", "Use a search of 1–160 characters");
    await startHuman(ctx, ask, acting, automation);
    let codes: string[];
    if (system === "MAILBOX") codes = (await searchMailbox(ctx, scope, { vesselId: scope.context.vesselId as Id<"vessels"> })).results.flatMap(result => result.documentCode ? [result.documentCode] : []);
    else if (system === "CUSTOMS_PORTAL") codes = (await searchCustomsPortal(ctx, scope, { portId: scope.context.portId as Id<"ports">, vesselId: scope.context.vesselId as Id<"vessels">, from: scope.context.window.from, to: scope.context.window.to })).results.flatMap(result => result.documentCode ? [result.documentCode] : []);
    else codes = (await ctx.db.query("documents").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).filter(doc => doc.system === "DOC_STORE" && (doc.receivedAt ?? 0) <= scope.simNow && (doc.vesselId === scope.context.vesselId || doc.caseId === ask.caseId)).map(doc => doc.code);
    const vessel = await ctx.db.get(scope.context.vesselId as Id<"vessels">);
    const results = [];
    for (const code of [...new Set(codes)]) {
      const { document } = await getDocument(ctx, scope, code);
      if (!`${document.title} ${document.code} ${vessel?.name ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) continue;
      results.push({ code: document.code, title: document.title, kind: document.kind, system: document.system, receivedAt: document.receivedAt ?? null });
    }
    await recordHuman(ctx, ask, acting, "SOURCE_SEARCHED", { system, query: query.trim(), resultDocumentCodes: results.map(result => result.code) }, automation);
    return results;
  },
});
export const openDocument = mutation({
  args: { caseCode: v.string(), documentCode: v.string(), ...automationArg }, returns: v.any(),
  handler: async (ctx, { caseCode, documentCode, automation }) => {
    const { acting, ask, scope } = await opsWork(ctx, caseCode);
    const { document } = await getDocument(ctx, scope, documentCode);
    await startHuman(ctx, ask, acting, automation);
    const search = (await eventsFor(ctx, ask)).filter(event => event.personaId === acting.persona._id && event.type === "SOURCE_SEARCHED" && ((event.payload as { resultDocumentCodes?: string[] }).resultDocumentCodes ?? []).includes(documentCode)).at(-1);
    await recordHuman(ctx, ask, acting, "DOCUMENT_OPENED", { documentCode, system: document.system, ...(search ? { searchSeq: search.seq } : {}) }, automation);
    return { code: document.code, title: document.title, kind: document.kind, receivedAt: document.receivedAt ?? null, url: await ctx.storage.getUrl(document.storageId) };
  },
});

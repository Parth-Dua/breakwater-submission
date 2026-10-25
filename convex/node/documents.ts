"use node";
// Node-side document services (ARCHITECTURE §11): text-layer extraction from storage. Agent-generated letters
// (laytime statements, claims, disputes) are rendered here in later phases with the same templates.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { renderDeskLetter } from "../../src/documents/letters";
import { internalAction } from "../_generated/server";
import { extractTextLayer as extract } from "../../src/documents/pdf-text";

export const extractTextLayer = internalAction({
  args: { storageId: v.id("_storage") },
  returns: v.string(),
  handler: async (ctx, { storageId }) => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new Error("Stored document not found");
    return extract(new Uint8Array(await blob.arrayBuffer()));
  },
});


export const renderFiling = internalAction({ args: { filingId: v.id("filings") }, returns: v.null(), handler: async (ctx, { filingId }): Promise<null> => {
  const input = await ctx.runQuery(internal.filingDocuments.data, { filingId }); if (!input) return null;
  const bytes = await renderDeskLetter(input), storageId = await ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const attached = await ctx.runMutation(internal.filingDocuments.attach, { filingId, storageId, textLayer: await extract(bytes) });
  if (!attached) await ctx.storage.delete(storageId);
  return null;
} });

export const renderStatement = internalAction({ args: { statementId: v.id("statements"), issuedAt: v.number() }, returns: v.null(), handler: async (ctx, { statementId, issuedAt }): Promise<null> => {
  const input = await ctx.runQuery(internal.filingDocuments.statementData, { statementId, issuedAt }); if (!input) return null;
  const bytes = await renderDeskLetter(input), storageId = await ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  if (!await ctx.runMutation(internal.filingDocuments.attachStatement, { statementId, issuedAt, storageId, textLayer: await extract(bytes) })) await ctx.storage.delete(storageId);
  return null;
} });

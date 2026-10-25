// Document import (V03): PDFs uploaded to Convex storage by scripts/world/import-documents.ts, registered here with
// their metadata and text layer from the bundled manifest. History mailbox messages and customs-portal records are
// created alongside (scripted cases get theirs when their world events release, V04). Idempotent by (ns, code).
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { appendAudit } from "../lib/audit";
import manifest from "../../fixtures/documents/manifest.json";
import history from "../../fixtures/world/history.json";
import type { HistoryCase } from "../../src/world/types";

type ManifestEntry = { ns: string; code: string; kind: string; system: string; title: string; vesselCode?: string; portCode?: string; receivedAt?: number; caseCode?: string; textLayer: string; sha256: string };
const MANIFEST = manifest as unknown as ManifestEntry[];
const HISTORY = (history as unknown as { cases: HistoryCase[] }).cases;

/** Codes from the manifest not yet registered in the namespace. */
export const pending = internalQuery({
  args: { ns: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, { ns }) => {
    const missing: string[] = [];
    for (const entry of MANIFEST.filter(item => item.ns === ns)) {
      const existing = await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", ns).eq("code", entry.code)).unique();
      if (!existing) missing.push(entry.code);
    }
    return missing;
  },
});

export const uploadUrls = internalMutation({
  args: { count: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, { count }) => Promise.all(Array.from({ length: count }, () => ctx.storage.generateUploadUrl())),
});

async function lookup(ctx: MutationCtx, table: "vessels" | "ports" | "cases", ns: string, code?: string) {
  if (!code) return undefined;
  const row = await ctx.db.query(table as "vessels").withIndex("by_code", q => q.eq("ns", ns).eq("code", code)).unique();
  return row?._id as unknown as Id<typeof table> | undefined;
}

export const register = internalMutation({
  args: { ns: v.string(), items: v.array(v.object({ code: v.string(), storageId: v.id("_storage") })) },
  returns: v.number(),
  handler: async (ctx, { ns, items }) => {
    let inserted = 0;
    for (const { code, storageId } of items) {
      const entry = MANIFEST.find(item => item.ns === ns && item.code === code);
      if (!entry) throw new Error(`Unknown document ${ns}:${code}`);
      const existing = await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", ns).eq("code", code)).unique();
      if (existing) { await ctx.storage.delete(storageId); continue; }
      const vesselId = await lookup(ctx, "vessels", ns, entry.vesselCode) as Id<"vessels"> | undefined;
      const portId = await lookup(ctx, "ports", ns, entry.portCode) as Id<"ports"> | undefined;
      const caseId = ns === "demo" ? await lookup(ctx, "cases", ns, entry.caseCode) as Id<"cases"> | undefined : undefined;
      const documentId = await ctx.db.insert("documents", {
        ns, origin: entry.caseCode && ns === "demo" ? "HISTORY_IMPORT" : "WORLD_SCRIPT",
        code, system: entry.system as never, kind: entry.kind as never, storageId, textLayer: entry.textLayer, title: entry.title,
        ...(vesselId ? { vesselId } : {}), ...(portId ? { portId } : {}), ...(caseId ? { caseId } : {}),
        ...(entry.receivedAt !== undefined ? { receivedAt: entry.receivedAt } : {}),
      });
      inserted++;
      // Contract register rows point at their signed PDF.
      const contracts = await ctx.db.query("contracts").withIndex("by_ns", q => q.eq("ns", ns)).collect();
      for (const contract of contracts) {
        if (contract.documentId) continue;
        if (contractDocumentCode(contract.formCode) === code) await ctx.db.patch(contract._id, { documentId });
      }
      // History: mailbox messages and customs-portal records exist from the start (they are the past).
      if (ns === "demo" && entry.caseCode) {
        const item = HISTORY.find(candidate => candidate.caseCode === entry.caseCode);
        if (entry.system === "MAILBOX") {
          const imo = item ? (await ctx.db.get(vesselId!))?.imo : undefined;
          await ctx.db.insert("mailMessages", { ns, origin: "HISTORY_IMPORT", documentId, from: senderFor(entry.kind), subject: entry.title, receivedAt: entry.receivedAt ?? 0, ...(imo ? { vesselImo: imo } : {}), bodyText: `${entry.title} attached.` });
        }
        const record = item?.customs.find(candidate => candidate.documentCode === code);
        if (record && portId && vesselId) await ctx.db.insert("customsRecords", { ns, origin: "HISTORY_IMPORT", portId, vesselId, kind: record.kind, startAt: record.startAt, ...(record.endAt !== undefined ? { endAt: record.endAt } : {}), documentId });
      }
    }
    if (inserted) await appendAudit(ctx, { ns, origin: "SYSTEM", actor: "system", role: "agent", type: "DOCUMENTS_IMPORTED", entityType: "namespace", entityId: ns, correlationId: `import:${ns}`, details: { inserted } });
    return inserted;
  },
});

function senderFor(kind: string) {
  return kind === "NOR" ? "master@vessel.example" : kind === "SOF" ? "ops@portagency.example" : kind === "OWNER_INVOICE" ? "accounts@owner.example" : "desk@meridian.example";
}

const FORM_DOCUMENT: Record<string, string> = {
  "NORDHAVN-CP-2019": "DOC-CP-NORDHAVN-2019", "THALASSA-CP-2021": "DOC-CP-THALASSA-2021", "OKEANOS-CP-2020": "DOC-CP-OKEANOS-2020",
  "PACCREST-CP-2022": "DOC-CP-PACCREST-2022", "KAIYO-CP-2021": "DOC-CP-KAIYO-2021", "HANSA-SC": "DOC-SC-HANSA-0917", "ALNOOR-SC": "DOC-SC-ALNOOR-0611",
  "SAIGONAG-SC": "DOC-SC-SAIGONAG", "LITORAL-PC": "DOC-PC-LITORAL-0802", "PAMPAS-PC": "DOC-PC-PAMPAS",
};
function contractDocumentCode(formCode: string) { return FORM_DOCUMENT[formCode]; }

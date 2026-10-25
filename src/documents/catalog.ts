// The full document catalog (WORLD §10): scripted cases, history, scoreboard and contract forms, per namespace.
import { FORMS } from "../world/forms";
import { generateHistory } from "../world/history";
import { generateScoreboard } from "../world/scoreboard";
import { SCRIPT_DOCUMENTS } from "../world/scripts";
import type { DocumentSpec } from "../world/types";

export type CatalogEntry = DocumentSpec & { ns: "demo" | "score"; caseCode?: string };

const DAY = 86_400_000;

function contractDocs(ns: "demo" | "score"): CatalogEntry[] {
  return Object.values(FORMS).map(form => ({
    ns, code: form.documentCode, kind: form.kind === "CHARTER_PARTY" ? "CHARTER_PARTY" : form.kind === "SALE" ? "SALE_CONTRACT" : "PURCHASE_CONTRACT",
    system: "DOC_STORE", title: `${form.kind === "CHARTER_PARTY" ? "Charter party" : form.kind === "SALE" ? "Sale contract" : "Purchase contract"} ${form.formCode}`,
    template: "contract", data: { contractCode: form.formCode, kind: form.kind, terms: form.truth },
  }));
}

export function documentCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: CatalogEntry) => { const key = `${entry.ns}:${entry.code}`; if (!seen.has(key)) { seen.add(key); entries.push(entry); } };
  for (const entry of contractDocs("demo")) add(entry);
  for (const spec of SCRIPT_DOCUMENTS) if (spec.template !== "contract") add({ ...spec, ns: "demo" });
  for (const item of generateHistory()) for (const spec of item.documents) add({ ...spec, ns: "demo", caseCode: item.caseCode });
  for (const entry of contractDocs("score")) add(entry);
  for (const voyage of generateScoreboard()) {
    for (const spec of voyage.documents) add({ ...spec, ns: "score", caseCode: voyage.caseCode });
    if (voyage.plants.includes("DUPLICATE_INVOICE")) {
      const invoice = voyage.documents.find(spec => spec.kind === "OWNER_INVOICE")!;
      add({ ...invoice, ns: "score", caseCode: voyage.caseCode, code: `${invoice.code}-DUP`, title: `${invoice.title}-R`, receivedAt: (invoice.receivedAt ?? 0) + 3 * DAY, data: { ...invoice.data, invoiceNo: `${String(invoice.data.invoiceNo)}-R` } });
    }
  }
  return entries;
}

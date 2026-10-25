// Renders every catalog document to fixtures/documents/<ns>/<code>.pdf and writes manifest.json with text layers.
// Deterministic: same inputs → identical bytes (fixed metadata dates, no random IDs).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { documentCatalog } from "../../src/documents/catalog";
import { extractTextLayer } from "../../src/documents/pdf-text";
import { renderDocument } from "./templates";

const entries = documentCatalog();
const manifest = [];
for (const entry of entries) {
  const bytes = await renderDocument(entry);
  const dir = `fixtures/documents/${entry.ns}`;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${entry.code}.pdf`;
  writeFileSync(file, bytes);
  const textLayer = await extractTextLayer(bytes);
  const { data: _data, template: _template, ...meta } = entry;
  void _data; void _template;
  manifest.push({ ...meta, file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, textLayer });
}
writeFileSync("fixtures/documents/manifest.json", JSON.stringify(manifest, null, 1) + "\n");
console.log(`documents: ${manifest.length} PDFs (${(manifest.reduce((n, m) => n + m.bytes, 0) / 1024 / 1024).toFixed(1)} MB)`);

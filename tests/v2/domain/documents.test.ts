import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { documentCatalog } from "../../../src/documents/catalog";
import { quoteInText } from "../../../src/documents/pdf-text";
import { renderDocument } from "../../../src/documents/templates";

type Entry = { ns: string; code: string; kind: string; system: string; file: string; sha256: string; textLayer: string };
const manifest = JSON.parse(readFileSync("fixtures/documents/manifest.json", "utf8")) as Entry[];
const byKey = new Map(manifest.map(entry => [`${entry.ns}:${entry.code}`, entry]));

describe("V03 documents", () => {
  test("every catalog document exists as a PDF with a text layer", () => {
    const catalog = documentCatalog();
    expect(catalog.length).toBe(manifest.length);
    for (const entry of catalog) {
      const item = byKey.get(`${entry.ns}:${entry.code}`);
      expect(item, entry.code).toBeDefined();
      expect(existsSync(item!.file)).toBe(true);
      expect(item!.textLayer.length).toBeGreaterThan(40);
    }
  });

  test("rendering is deterministic and the committed PDFs are current", async () => {
    const catalog = documentCatalog();
    for (const code of ["DOC-INV-NORDHAVN-2611", "DOC-SOF-ASTERVALE", "DOC-RTM-CLOSURE-1028", "DOC-CP-NORDHAVN-2019"]) {
      const spec = catalog.find(entry => entry.ns === "demo" && entry.code === code)!;
      const a = await renderDocument(spec), b = await renderDocument(spec);
      const sha = createHash("sha256").update(a).digest("hex");
      expect(createHash("sha256").update(b).digest("hex")).toBe(sha);
      expect(byKey.get(`demo:${code}`)!.sha256).toBe(sha);
      expect(createHash("sha256").update(readFileSync(byKey.get(`demo:${code}`)!.file)).digest("hex")).toBe(sha);
    }
  });

  test("every WORLD fact has a verbatim quote in its document's text layer (fixtures/documents/quotes.json)", () => {
    const table = JSON.parse(readFileSync("fixtures/documents/quotes.json", "utf8")) as { ns: string; code: string; quotes: string[] }[];
    for (const row of table) for (const quote of row.quotes) expect(quoteInText(quote, byKey.get(`${row.ns}:${row.code}`)!.textLayer), `${row.code}: ${quote}`).toBe(true);
  });

  test("NORDHAVN-CP-2019 cl. 8 proviso is on page 3; customs releases live only in the customs portal", () => {
    const pages = byKey.get("demo:DOC-CP-NORDHAVN-2019")!.textLayer.split("\f");
    expect(pages.length).toBe(4);
    expect(quoteInText("unless the vessel is already on demurrage", pages[2])).toBe(true);
    expect(quoteInText("unless the vessel is already on demurrage", pages.slice(0, 2).join(" "))).toBe(false);
    const releases = manifest.filter(entry => entry.kind === "CUSTOMS_RELEASE");
    expect(releases.length).toBeGreaterThan(5);
    expect(releases.every(entry => entry.system === "CUSTOMS_PORTAL")).toBe(true);
  });
});

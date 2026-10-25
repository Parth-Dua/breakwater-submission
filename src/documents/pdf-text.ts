// Text layer extraction (pdfjs, Node). Used at import time and by Convex Node actions (ARCHITECTURE §11).
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// Run the pdfjs worker in-process (bundled) so no separate worker file must be resolvable at runtime (Convex Node).
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

type TextItem = { str: string; hasEOL?: boolean };

export async function extractTextLayer(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push((content.items as TextItem[]).map(item => item.str + (item.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+\n/g, "\n").trim());
  }
  await task.destroy();
  return pages.join("\n\f\n");
}

/** Quote check used by extraction verification: whitespace-collapsed, case-insensitive containment. */
export function normalizeForQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
export function quoteInText(quote: string, textLayer: string): boolean {
  const needle = normalizeForQuote(quote);
  return needle.length > 0 && normalizeForQuote(textLayer).includes(needle);
}

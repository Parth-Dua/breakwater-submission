// Deterministic PDF templates (pdf-lib). Each document kind has 4 layout variants chosen from the document code,
// so documents from different companies look different (WORLD §10). Used by the generator and by Convex Node actions.
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { DocumentSpec } from "../world/types";

const A4: [number, number] = [595.28, 841.89];
const FIXED_DATE = new Date(Date.UTC(2026, 0, 1));
type Fonts = { regular: PDFFont; bold: PDFFont; mono: PDFFont; serif: PDFFont; serifBold: PDFFont };
type Ctx = { doc: PDFDocument; page: PDFPage; fonts: Fonts; variant: number; accent: RGB; y: number };

const ACCENTS = [rgb(0.04, 0.12, 0.23), rgb(0.42, 0.09, 0.09), rgb(0.05, 0.33, 0.29), rgb(0.27, 0.27, 0.3)];

/** Replace characters outside WinAnsi (standard fonts) with safe equivalents. */
export function winAnsi(text: string): string {
  return text.replace(/[→⇢]/g, "->").replace(/[≈]/g, "~").replace(/[✓]/g, "OK").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/−/g, "-");
}

function variantOf(code: string): number {
  let hash = 0;
  for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 4;
}

function text(ctx: Ctx, value: string, x: number, size = 10, font: PDFFont = ctx.fonts.regular, color = rgb(0.1, 0.12, 0.16)) {
  ctx.page.drawText(winAnsi(value), { x, y: ctx.y, size, font, color });
}

function wrap(font: PDFFont, value: string, size: number, width: number): string[] {
  const words = winAnsi(value).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && line) { lines.push(line); line = word; } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function paragraph(ctx: Ctx, value: string, x: number, width: number, size = 10, font: PDFFont = ctx.fonts.regular, leading = 1.4) {
  for (const line of wrap(font, value, size, width)) {
    text(ctx, line, x, size, font);
    ctx.y -= size * leading;
  }
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage(A4);
  ctx.y = A4[1] - 60;
}

function letterhead(ctx: Ctx, name: string, sub: string) {
  const { page, accent, variant, fonts } = ctx;
  const [w, h] = A4;
  if (variant === 0) { page.drawRectangle({ x: 0, y: h - 70, width: w, height: 70, color: accent }); page.drawText(winAnsi(name), { x: 48, y: h - 42, size: 18, font: fonts.bold, color: rgb(1, 1, 1) }); page.drawText(winAnsi(sub), { x: 48, y: h - 58, size: 9, font: fonts.regular, color: rgb(0.9, 0.92, 0.95) }); ctx.y = h - 110; }
  else if (variant === 1) { page.drawText(winAnsi(name.toUpperCase()), { x: 48, y: h - 60, size: 16, font: fonts.serifBold, color: accent }); page.drawText(winAnsi(sub), { x: 48, y: h - 76, size: 9, font: fonts.serif, color: rgb(0.35, 0.35, 0.4) }); page.drawLine({ start: { x: 48, y: h - 86 }, end: { x: w - 48, y: h - 86 }, thickness: 1.5, color: accent }); ctx.y = h - 120; }
  else if (variant === 2) { const width = fonts.bold.widthOfTextAtSize(winAnsi(name), 15); page.drawText(winAnsi(name), { x: (w - width) / 2, y: h - 58, size: 15, font: fonts.bold, color: accent }); const sw = fonts.regular.widthOfTextAtSize(winAnsi(sub), 8.5); page.drawText(winAnsi(sub), { x: (w - sw) / 2, y: h - 72, size: 8.5, font: fonts.regular, color: rgb(0.4, 0.4, 0.45) }); ctx.y = h - 110; }
  else { page.drawRectangle({ x: 48, y: h - 84, width: 6, height: 40, color: accent }); page.drawText(winAnsi(name), { x: 62, y: h - 60, size: 15, font: fonts.bold, color: rgb(0.1, 0.1, 0.12) }); page.drawText(winAnsi(sub), { x: 62, y: h - 76, size: 9, font: fonts.regular, color: rgb(0.4, 0.4, 0.45) }); ctx.y = h - 116; }
}

function table(ctx: Ctx, headers: string[], rows: string[][], columns: number[], x = 48) {
  const { page, fonts, variant, accent } = ctx;
  const width = columns.reduce((sum, column) => sum + column, 0);
  const rowHeight = 18;
  page.drawRectangle({ x, y: ctx.y - 5, width, height: rowHeight, color: variant % 2 ? rgb(0.93, 0.94, 0.96) : accent, opacity: variant % 2 ? 1 : 0.95 });
  let cx = x + 6;
  headers.forEach((header, index) => { page.drawText(winAnsi(header), { x: cx, y: ctx.y, size: 9, font: fonts.bold, color: variant % 2 ? rgb(0.1, 0.1, 0.12) : rgb(1, 1, 1) }); cx += columns[index]; });
  ctx.y -= rowHeight;
  rows.forEach((row, rowIndex) => {
    if (ctx.y < 90) newPage(ctx);
    if (variant === 2 && rowIndex % 2) ctx.page.drawRectangle({ x, y: ctx.y - 5, width, height: rowHeight, color: rgb(0.97, 0.97, 0.98) });
    cx = x + 6;
    row.forEach((cell, index) => { ctx.page.drawText(winAnsi(cell), { x: cx, y: ctx.y, size: 9, font: variant === 1 ? fonts.serif : fonts.regular, color: rgb(0.12, 0.12, 0.15) }); cx += columns[index]; });
    if (variant !== 2) ctx.page.drawLine({ start: { x, y: ctx.y - 6 }, end: { x: x + width, y: ctx.y - 6 }, thickness: 0.4, color: rgb(0.8, 0.82, 0.85) });
    ctx.y -= rowHeight;
  });
}

function stamp(ctx: Ctx, label: string, x: number, y: number, color = rgb(0.16, 0.3, 0.6)) {
  ctx.page.drawEllipse({ x, y, xScale: 46, yScale: 30, borderColor: color, borderWidth: 1.6, opacity: 0, borderOpacity: 0.75 });
  const width = ctx.fonts.bold.widthOfTextAtSize(winAnsi(label), 8);
  ctx.page.drawText(winAnsi(label), { x: x - width / 2, y: y - 3, size: 8, font: ctx.fonts.bold, color, opacity: 0.8, rotate: degrees(-8) });
}

const money = (cents: number) => `USD ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hours = (minutes: number) => `${(minutes / 60).toFixed(2)} h`;

// ---------------------------------------------------------------- templates
type Data = Record<string, unknown>;
type Renderer = (ctx: Ctx, spec: DocumentSpec, data: Data) => void;

const norEmail: Renderer = (ctx, spec, d) => {
  ctx.y = A4[1] - 70;
  const mono = ctx.fonts.mono;
  const lines = [
    `From:    Master, ${d.vessel}`,
    `To:      Meridian Commodities SA (charterers); ${d.owner}`,
    `Date:    ${d.tenderedText}`,
    `Subject: ${d.vessel} - Notice of Readiness - ${d.port}`,
  ];
  for (const line of lines) { text(ctx, line, 48, 10, mono); ctx.y -= 15; }
  ctx.page.drawLine({ start: { x: 48, y: ctx.y + 4 }, end: { x: A4[0] - 48, y: ctx.y + 4 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) });
  ctx.y -= 20;
  text(ctx, "NOTICE OF READINESS", 48, 12, ctx.fonts.bold); ctx.y -= 24;
  paragraph(ctx, `Please accept this as Notice of Readiness for ${d.vessel} (IMO ${d.imo}).`, 48, 480, 10, mono);
  paragraph(ctx, `NOR tendered ${d.tenderedText}.`, 48, 480, 10, mono);
  paragraph(ctx, String(d.claim ?? `Vessel arrived ${d.location}, ready in all respects to load/discharge her cargo.`), 48, 480, 10, mono);
  ctx.y -= 10;
  paragraph(ctx, "Laytime to commence in accordance with the governing charter party.", 48, 480, 10, mono);
  ctx.y -= 24;
  text(ctx, ["Best regards,", "Rgds,", "Kind regards,", "Regards,"][ctx.variant], 48, 10, mono); ctx.y -= 15;
  text(ctx, `Master, ${d.vessel}`, 48, 10, mono);
};

const sofTable: Renderer = (ctx, spec, d) => {
  letterhead(ctx, String(d.agent ?? "Port Agency"), `Port agents · ${d.port}`);
  text(ctx, "STATEMENT OF FACTS", 48, 14, ctx.fonts.bold); ctx.y -= 22;
  for (const [label, value] of [["Vessel", d.vessel], ["Port", d.port], ["Charterers", "Meridian Commodities SA"]] as const) { text(ctx, `${label}:`, 48, 10, ctx.fonts.bold); text(ctx, String(value), 140, 10); ctx.y -= 15; }
  ctx.y -= 10;
  const rows = (d.rows as { localText: string; fold?: number; entry: string }[]).map(row => [`${row.localText}${row.fold === 1 ? " (2nd)" : ""}`, row.entry]);
  table(ctx, d.bilingual ? ["Data/Hora (local) / Date/Time", "Evento / Event"] : ["Date / Time (local)", "Event"], rows, [150, 350]);
  ctx.y -= 16;
  paragraph(ctx, `All times local (${d.zone}).`, 48, 480, 9, ctx.fonts.regular);
  ctx.y -= 40;
  ctx.page.drawLine({ start: { x: 48, y: ctx.y }, end: { x: 228, y: ctx.y }, thickness: 0.6, color: rgb(0.3, 0.3, 0.3) });
  ctx.page.drawLine({ start: { x: 330, y: ctx.y }, end: { x: 510, y: ctx.y }, thickness: 0.6, color: rgb(0.3, 0.3, 0.3) });
  ctx.y -= 12; text(ctx, "Master", 48, 9); text(ctx, "Agent", 330, 9);
  stamp(ctx, String(d.agent ?? "AGENT").split(" ").slice(0, 2).join(" ").toUpperCase(), 430, ctx.y + 40);
};

const ownerInvoice: Renderer = (ctx, spec, d) => {
  letterhead(ctx, String(d.owner), "Shipowners · Demurrage department");
  text(ctx, `DEMURRAGE INVOICE ${d.invoiceNo}`, 48, 14, ctx.fonts.bold); ctx.y -= 22;
  for (const [label, value] of [["To", "Meridian Commodities SA, Geneva"], ["Vessel", d.vessel], ["Laytime commenced", `${d.laytimeStartText}`], ["Completed", `${d.completionText}`], ["Rate", `${money(Number(d.ratePerDayCents))} per day pro rata`]] as const) { text(ctx, `${label}:`, 48, 10, ctx.fonts.bold); text(ctx, String(value), 170, 10); ctx.y -= 15; }
  ctx.y -= 10;
  const currency = d.currency === "EUR" ? "EUR" : "USD";
  const fmt = (cents: number) => `${currency} ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines = (d.lines as { label: string; minutes?: number; cents: number }[]).map(line => [line.label, line.minutes === undefined ? "" : hours(line.minutes), line.cents ? fmt(line.cents) : ""]);
  table(ctx, ["Item", "Time", "Amount"], lines, [260, 110, 130]);
  ctx.y -= 6;
  text(ctx, "TOTAL DUE", 330, 11, ctx.fonts.bold); text(ctx, fmt(Number(d.totalCents)), 420, 11, ctx.fonts.bold);
  ctx.y -= 40;
  paragraph(ctx, "Payment within 30 days to: Nordic Maritime Bank, IBAN NO00 0000 0000 000 (synthetic). Please quote the invoice number.", 48, 480, 8.5);
  if (d.footer) { ctx.y = 56; paragraph(ctx, String(d.footer), 48, 480, 7, ctx.fonts.regular, 1.2); }
};

const portAdvisory: Renderer = (ctx, spec, d) => {
  letterhead(ctx, `Port of ${d.port}`, "Harbour Master's Office · Nautical advisory");
  text(ctx, "ADVISORY", 48, 13, ctx.fonts.bold); text(ctx, `Issued ${d.issued}`, 360, 9); ctx.y -= 24;
  const body = d.body as string[];
  const columnWidth = ctx.variant % 2 ? 480 : 230;
  const startY = ctx.y;
  body.forEach((item, index) => {
    if (ctx.variant % 2 === 0 && index === Math.ceil(body.length / 2)) ctx.y = startY;
    const x = ctx.variant % 2 === 0 && index >= Math.ceil(body.length / 2) ? 298 : 48;
    paragraph(ctx, item, x, columnWidth, 10);
    ctx.y -= 8;
  });
};

const portClosureScanned: Renderer = (ctx, spec, d) => {
  const [w, h] = A4;
  ctx.page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: rgb(0.93, 0.92, 0.89) });
  const rotate = degrees(0.6);
  const lines = [
    `PORT OF ${String(d.port).toUpperCase()} - HARBOUR MASTER`,
    "",
    "NOTICE TO SHIPPING",
    "",
    `The port is CLOSED to all vessel movements from ${d.fromText}`,
    `until ${d.toText} due to ${d.reason ?? "severe weather"}.`,
    "",
    "Vessels at anchor shall maintain a full watch.",
    "This notice supersedes previous instructions.",
    "",
    "Harbour Master",
  ];
  let y = h - 120;
  for (const line of lines) { ctx.page.drawText(winAnsi(line), { x: 70, y, size: 11, font: ctx.fonts.mono, color: rgb(0.15, 0.15, 0.17), rotate }); y -= 18; }
  stamp(ctx, "HARBOUR MASTER", 420, h - 360, rgb(0.55, 0.12, 0.12));
};

const customsForm: Renderer = (ctx, spec, d) => {
  letterhead(ctx, String(d.authority), "Customs and phytosanitary services");
  const title = d.kind === "RELEASE" ? "CARGO RELEASE" : "CARGO HOLD NOTICE";
  text(ctx, title, 48, 14, ctx.fonts.bold); ctx.y -= 26;
  const fields: [string, string][] = [["Reference", String(d.reference ?? spec.code.replace(/^DOC-/, ""))], ["Vessel", `${d.vessel} (IMO ${d.imo})`]];
  if (d.kind === "RELEASE") fields.push(["Hold covered from", `${d.coveredFromLocal} (local)`], ["Hold covered to", `${d.coveredToLocal} (local)`], ["Status", "Released"]);
  else fields.push(["Hold from", `${d.fromLocal} (local)`], ["Status", "On hold pending inspection"]);
  for (const [label, value] of fields) {
    ctx.page.drawRectangle({ x: 48, y: ctx.y - 8, width: 500, height: 24, borderColor: rgb(0.7, 0.72, 0.75), borderWidth: 0.6, opacity: 0 });
    text(ctx, label, 56, 8, ctx.fonts.bold, rgb(0.4, 0.4, 0.45)); text(ctx, value, 200, 10);
    ctx.y -= 28;
  }
  stamp(ctx, d.kind === "RELEASE" ? "RELEASED" : "HOLD", 470, ctx.y - 20, d.kind === "RELEASE" ? rgb(0.05, 0.4, 0.2) : rgb(0.6, 0.1, 0.1));
};

type TermsLike = { noticeMinutes: number; laytimeMinutes: number; ratePerHourCents: number; exceptionsApplyOnDemurrage: boolean;
  treatments: Record<string, { treatment: string; clause: string; requiresEvidence?: string[] }>; timeBar: { days: number; requires: string[] } | null };

/** Clause text derived from the signed terms. `trueTerms` is the signed contract (NORDHAVN keeps its cl. 8 proviso). */
function clausesFor(kind: string, terms: TermsLike): [number, string][] {
  const h = (minutes: number) => `${minutes / 60} running hours`;
  const rate = `USD ${((terms.ratePerHourCents * 24) / 100).toLocaleString("en-US")} per day pro rata`;
  const treat = (key: string, subject: string) => {
    const rule = terms.treatments[key];
    const base = rule.treatment === "COUNT" ? `${subject} shall count as laytime` : rule.treatment === "HALF" ? `${subject} shall count as half laytime` : `${subject} shall not count as laytime`;
    const evidence = rule.requiresEvidence?.length ? ", but only if supported by an official hold or release record" : "";
    const proviso = (key === "PORT_CLOSURE" || key === "WEATHER") && !terms.exceptionsApplyOnDemurrage && rule.treatment !== "COUNT" ? ", unless the vessel is already on demurrage" : "";
    return [Number(rule.clause), `${base}${evidence}${proviso}.`] as [number, string];
  };
  const party = kind === "CHARTER_PARTY" ? "Owners'" : kind === "SALE" ? "Sellers'" : "Buyers'";
  const clauses: [number, string][] = [
    [1, kind === "CHARTER_PARTY" ? "Description. The vessel shall proceed to the port(s) named herein and there load/discharge the cargo." : "Goods. Bulk grain of the quality and quantity stated in the fixture recap."],
    [2, kind === "CHARTER_PARTY" ? "Freight. Freight shall be paid as agreed in the fixture recap." : "Price. As agreed in the recap, payable against documents."],
    [3, "Cargo. Bulk grain in accordance with the contract specification."],
    [4, "Operations. Free in and out; stevedores arranged as agreed."],
    [5, `Notice of Readiness. NOR may be tendered on arrival at the customary anchorage within port limits when the vessel is ready in all respects. Laytime shall commence ${h(terms.noticeMinutes)} after a valid NOR. (c) A NOR tendered before arrival within port limits shall be deemed tendered upon arrival.`],
    [6, `Laytime. ${h(terms.laytimeMinutes)}, Sundays and holidays included, whether in berth or not.`],
    treat("SHIFTING", "Time used shifting from anchorage to the first berth"),
    treat("PORT_CLOSURE", "Time lost by reason of weather or closure of the port by the authorities"),
    treat("CUSTOMS_HOLD", "Time lost for customs or phytosanitary inspection of the cargo"),
    [kind === "CHARTER_PARTY" ? 10 : 15, `Demurrage. Demurrage shall be paid at ${rate}.`],
    [16, `Claims. ${party} claims for demurrage shall be presented within ${terms.timeBar?.days ?? 90} days of completion with ${terms.timeBar?.requires.join(" and ") ?? "supporting documents"}, failing which they are waived.`],
    [17, "Law and arbitration. English law; London arbitration."],
  ];
  const unique = new Map<number, string>();
  for (const [number, body] of clauses) unique.set(number, unique.has(number) ? `${unique.get(number)} ${body}` : body);
  return [...unique.entries()].sort((a, b) => a[0] - b[0]);
}

const contract: Renderer = (ctx, spec, d) => {
  letterhead(ctx, String(spec.title), "Signed copy · Meridian Commodities SA Legal");
  paragraph(ctx, `This contract is made between Meridian Commodities SA and the counterparty named in the fixture recap (${d.contractCode}).`, 48, 480, 10, ctx.fonts.serif);
  ctx.y -= 10;
  // Page breaks before the first clause at or past 5, 8 and 10: charter parties run 4 pages with cl. 8 opening page 3.
  const thresholds = [5, 8, 10];
  for (const [number, body] of clausesFor(String(d.kind), d.terms as TermsLike)) {
    if (thresholds.length && number >= thresholds[0]) { newPage(ctx); while (thresholds.length && number >= thresholds[0]) thresholds.shift(); }
    text(ctx, `Clause ${number}`, 48, 11, ctx.fonts.serifBold); ctx.y -= 16;
    paragraph(ctx, body, 48, 480, 10, ctx.fonts.serif);
    ctx.y -= 12;
  }
};

const RENDERERS: Record<string, Renderer> = {
  "nor-email": norEmail, "sof-table": sofTable, "owner-invoice": ownerInvoice, "port-advisory": portAdvisory,
  "port-closure-scanned": portClosureScanned, "customs-form": customsForm, contract,
};

export async function renderDocument(spec: DocumentSpec): Promise<Uint8Array> {
  const renderer = RENDERERS[spec.template];
  if (!renderer) throw new Error(`Unknown template ${spec.template}`);
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(winAnsi(spec.title)); doc.setAuthor("Breakwater world generator"); doc.setProducer("pdf-lib"); doc.setCreator("breakwater");
  doc.setCreationDate(FIXED_DATE); doc.setModificationDate(FIXED_DATE);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier), serif: await doc.embedFont(StandardFonts.TimesRoman), serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
  };
  const variant = variantOf(spec.code);
  const ctx: Ctx = { doc, page: doc.addPage(A4), fonts, variant, accent: ACCENTS[variant], y: A4[1] - 60 };
  renderer(ctx, spec, spec.data);
  return doc.save({ useObjectStreams: false });
}

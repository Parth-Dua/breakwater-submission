"use node";
// read_document (CONTRACTS §10.4, REQ-SRC-02): the PDF goes to Claude as a document block; each field comes back as
// { value, quote }. A field counts only if its quote is in the PDF text layer and its value parses. One repair turn.
import type { BetaContentBlock, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { callClaude, type ClaudeRequest, type Usage } from "./claude";
import { EXTRACTION_SYSTEM } from "./prompts/agent";
import { parseHoursToMinutes, parseMoney, parseSofLocal, parseUtcDateTime } from "../../src/domain/parse";

type Field = { value: string; quote: string };
type Check = (field: Field) => boolean;

const field = { type: "object", properties: { value: { type: "string" }, quote: { type: "string" } }, required: ["value", "quote"], additionalProperties: false };
const schemaOf = (fields: Record<string, unknown>) => ({
  type: "object",
  properties: { ...fields, ignoredInstructions: { type: "array", items: { type: "string" } } },
  required: [...Object.keys(fields), "ignoredInstructions"], additionalProperties: false,
});

const isDate: Check = f => parseUtcDateTime(f.quote) !== null;
const isMoney: Check = f => parseMoney(f.quote) !== null;
const isHours: Check = f => parseHoursToMinutes(f.quote) !== null;
const any: Check = () => true;

type Spec = { schema: Record<string, unknown>; checks: Record<string, Check>; required: string[] };
const SPECS: Record<string, Spec> = {
  NOR: { schema: schemaOf({ tenderedAt: field, statedLocation: field, vesselName: field }), checks: { tenderedAt: isDate, statedLocation: any, vesselName: any }, required: ["tenderedAt"] },
  OWNER_INVOICE: {
    schema: schemaOf({ invoiceNo: field, laytimeStart: field, completion: field, timeUsed: field, demurrageTime: field, demurrageAmount: field, total: field, fees: { type: "array", items: { type: "object", properties: { label: field, amount: field }, required: ["label", "amount"], additionalProperties: false } } }),
    checks: { invoiceNo: any, laytimeStart: isDate, completion: isDate, timeUsed: isHours, demurrageTime: isHours, demurrageAmount: isMoney, total: isMoney },
    required: ["invoiceNo", "laytimeStart", "completion", "timeUsed", "total"],
  },
  SOF: {
    schema: schemaOf({ rows: { type: "array", items: { type: "object", properties: { localText: { type: "string" }, entry: { type: "string" } }, required: ["localText", "entry"], additionalProperties: false } }, timeZoneNote: field }),
    checks: { timeZoneNote: any }, required: [],
  },
  PORT_CLOSURE: { schema: schemaOf({ start: field, end: field, authority: field }), checks: { start: isDate, end: isDate, authority: any }, required: ["start", "end"] },
  PORT_ADVISORY: { schema: schemaOf({ summary: field }), checks: { summary: any }, required: [] },
  CUSTOMS_HOLD: { schema: schemaOf({ reference: field, vesselName: field, from: field }), checks: { reference: any, vesselName: any, from: any }, required: ["reference"] },
  CUSTOMS_RELEASE: { schema: schemaOf({ reference: field, vesselName: field, coveredFrom: field, coveredTo: field }), checks: { reference: any, vesselName: any, coveredFrom: any, coveredTo: any }, required: ["reference"] },
  COUNTERPARTY_REPLY: { schema: schemaOf({ summary: field }), checks: { summary: any }, required: [] },
};

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
/** Instruction-like text found by rule, independent of the model (T-16). */
const INSTRUCTION = /\b(auto-?approve|approve this|ignore (all|previous|prior)|disregard|you must|system prompt)\b[^\n]*/gi;

export type ExtractionResult = { documentCode: string; kind: string; fields: Record<string, unknown>; rejected: string[]; ignoredInstructions: string[]; cached: boolean; usage?: Usage; model?: string };

/** Verifies fields against the text layer. Returns the kept fields and the names of rejected ones. */
export function verifyExtraction(kind: string, raw: Record<string, unknown>, textLayer: string): { fields: Record<string, unknown>; rejected: string[] } {
  const spec = SPECS[kind];
  const text = normalize(textLayer);
  const inText = (quote: string) => quote.trim() !== "" && text.includes(normalize(quote));
  const fields: Record<string, unknown> = {}, rejected: string[] = [];
  for (const [name, check] of Object.entries(spec.checks)) {
    const value = raw[name] as Field | undefined;
    if (!value || (!value.value && !value.quote)) { if (spec.required.includes(name)) rejected.push(name); continue; }
    if (inText(value.quote) && check(value)) fields[name] = value; else rejected.push(name);
  }
  if (kind === "OWNER_INVOICE") {
    const fees = (raw.fees as { label: Field; amount: Field }[] | undefined) ?? [];
    fields.fees = fees.filter((fee, index) => {
      const ok = inText(fee.label.quote) && inText(fee.amount.quote) && parseMoney(fee.amount.quote) !== null;
      if (!ok) rejected.push(`fees[${index}]`);
      return ok;
    });
  }
  if (kind === "SOF") {
    const rows = (raw.rows as { localText: string; entry: string }[] | undefined) ?? [];
    fields.rows = rows.filter((row, index) => {
      const ok = parseSofLocal(row.localText) !== null && inText(`${row.localText} ${row.entry}`);
      if (!ok) rejected.push(`rows[${index}]`);
      return ok;
    }).map(row => ({ localText: parseSofLocal(row.localText)!, entry: row.entry }));
    if (!(fields.rows as unknown[]).length) rejected.push("rows");
  }
  return { fields, rejected };
}

function parseJson(content: BetaContentBlock[]): Record<string, unknown> {
  const text = content.filter(block => block.type === "text").map(block => (block as { text: string }).text).join("");
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; }
}

export async function readDocument(ctx: ActionCtx, taskId: Id<"agentTasks">, token: string, input: { caseCode?: string; documentCode: string }, controls: Pick<ClaudeRequest, "deadlineAt" | "beforeAttempt"> = {}): Promise<ExtractionResult> {
  const doc: { documentId: Id<"documents">; code: string; kind: string; storageId: Id<"_storage">; textLayer: string; cached: { fields: Record<string, unknown>; rejected: string[] } | null } =
    await ctx.runQuery(internal.agent.tools.documentForExtraction, { taskId, token, input });
  const ruleFlags = [...doc.textLayer.matchAll(INSTRUCTION)].map(match => match[0].trim());
  if (doc.cached) return { documentCode: doc.code, kind: doc.kind, fields: doc.cached.fields, rejected: doc.cached.rejected, ignoredInstructions: ruleFlags, cached: true };
  const spec = SPECS[doc.kind];
  if (!spec) return { documentCode: doc.code, kind: doc.kind, fields: { text: doc.textLayer.slice(0, 2000) }, rejected: [], ignoredInstructions: ruleFlags, cached: false };
  const blob = await ctx.storage.get(doc.storageId);
  if (!blob) throw new Error("Document file missing from storage");
  const data = Buffer.from(await blob.arrayBuffer()).toString("base64");
  const messages: BetaMessageParam[] = [{ role: "user", content: [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
    { type: "text", text: `Document kind: ${doc.kind}. Extract the fields.` },
  ] }];
  const usage: Usage = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 };
  const add = (next: Usage) => { usage.tokensIn += next.tokensIn; usage.tokensOut += next.tokensOut; usage.cacheRead += next.cacheRead; usage.cacheWrite += next.cacheWrite; };
  let response = await callClaude({ ...controls, system: EXTRACTION_SYSTEM, messages, effort: "low", format: spec.schema });
  add(response.usage);
  let raw = parseJson(response.message.content);
  let verified = verifyExtraction(doc.kind, raw, doc.textLayer);
  if (verified.rejected.length) {
    messages.push({ role: "assistant", content: response.message.content.filter(block => block.type === "text") as never });
    messages.push({ role: "user", content: `These fields' quotes were not found verbatim in the document or did not parse: ${verified.rejected.join(", ")}. Copy each quote exactly as printed, or leave value and quote empty if the document does not state it.` });
    response = await callClaude({ ...controls, system: EXTRACTION_SYSTEM, messages, effort: "low", format: spec.schema });
    add(response.usage);
    raw = parseJson(response.message.content);
    verified = verifyExtraction(doc.kind, raw, doc.textLayer);
  }
  const modelFlags = ((raw.ignoredInstructions as string[] | undefined) ?? []).filter(quote => normalize(doc.textLayer).includes(normalize(quote)));
  const ignoredInstructions = [...new Set([...ruleFlags, ...modelFlags])];
  await ctx.runMutation(internal.agent.tools.saveExtraction, { taskId, token, documentId: doc.documentId, kind: doc.kind, fields: verified.fields, rejected: verified.rejected, model: response.model });
  return { documentCode: doc.code, kind: doc.kind, fields: verified.fields, rejected: verified.rejected, ignoredInstructions, cached: false, usage, model: response.model };
}

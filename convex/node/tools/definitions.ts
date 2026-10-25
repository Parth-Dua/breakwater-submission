// Tool definitions offered to Claude (CONTRACTS §10.3). Strict schemas; deterministic order (prompt-cache prefix).
// Times in tool inputs and outputs are ISO-8601 UTC strings; the dispatcher converts them.
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";

type Schema = Record<string, unknown>;
const object = (properties: Record<string, Schema>, required: string[] = Object.keys(properties)): BetaTool["input_schema"] =>
  ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string): Schema => ({ type: "string", description });
const int = (description: string): Schema => ({ type: "integer", description });
const bool = (description: string): Schema => ({ type: "boolean", description });
const strings = (description: string): Schema => ({ type: "array", items: { type: "string" }, description });
const caseCode = str("Case code, e.g. from get_case_snapshot");
const INTERVAL_KINDS = ["SHIFTING", "PORT_CLOSURE", "WEATHER", "CUSTOMS_HOLD"]; // the exception kinds the engine applies
const DOC_KINDS = ["NOR", "SOF", "OWNER_INVOICE", "PORT_ADVISORY", "PORT_CLOSURE", "CUSTOMS_HOLD", "CUSTOMS_RELEASE", "COUNTERPARTY_REPLY"];

// The API caps the grammar compiled for strict tools ("compiled grammar is too large" with all 22 strict), so strict
// decoding is kept for the tools that write to the books or route decisions; every tool's input is also validated
// against its schema by the dispatcher before it runs (validateInput), strict or not.
const STRICT = new Set(["open_case", "check_nor", "verify_hold", "compute_statement", "reconcile_invoice", "post_accrual", "post_ap", "file_recovery", "create_ask"]);
const def = (name: string, description: string, input_schema: BetaTool["input_schema"]): BetaTool => ({ name, description, input_schema, ...(STRICT.has(name) ? { strict: true } : {}) });

export const TOOL_DEFINITIONS: BetaTool[] = [
  def("record_step", "Show a step to the people watching. Call with RUNNING before a check and DONE after it. Never state amounts.", object({
    status: { type: "string", enum: ["RUNNING", "DONE"] },
    title: str("Plain-words title, at most 60 characters"),
    observation: str("What you saw (optional)"), check: str("What you checked (optional)"), conclusion: str("What follows (optional)"),
    evidenceDocs: strings("Document codes this step relied on"),
    memoryRefs: strings("Memory item codes this step used"),
  }, ["status", "title", "evidenceDocs", "memoryRefs"])),
  def("get_case_snapshot", "Facts, statements, documents received, asks, filings, accruals and applicable memory for a case.", object({ caseCode })),
  def("list_fleet", "Vessels with voyages due now or soon, with ETA and any open case.", object({})),
  def("list_open_cases", "Open cases with whether laytime has started, the accrued amount and whether AP is posted.", object({})),
  def("open_case", "Open a demurrage case for a vessel due at the notice's port within 72 hours.", object({ vesselCode: str("Vessel code from list_fleet"), reason: str("Short reason, at most 48 characters") })),
  def("search_mailbox", "Messages and attachments received for the case vessel so far.", object({ caseCode, kinds: { type: "array", items: { type: "string", enum: DOC_KINDS } } }, ["caseCode"])),
  def("read_document", "Read a document and return verified fields with verbatim quotes. Unverifiable fields are listed as rejected.", object({ caseCode, documentCode: str("Document code") })),
  def("get_ais", "AIS summary for the case vessel: arrival in port limits, movements after arrival, dark gaps, last position; optional positions at given times.", object({ caseCode, at: strings("ISO UTC times to report positions at (max 4)") }, ["caseCode"])),
  def("check_nor", "Check a read NOR against AIS and port limits; records tender, validity and both laytime starts.", object({ caseCode, documentCode: str("NOR document code") })),
  def("convert_local_times", "Convert SOF local times to UTC with the port's time zone (DST aware). fold 1 = the second occurrence of a repeated hour.", object({ caseCode, rows: { type: "array", items: object({ localText: str("Local time as written, e.g. 24.10 20:00"), fold: { type: "integer", enum: [0, 1] } }, ["localText"]) } })),
  def("record_intervals", "Record facts from a read SOF (by row index) and from AIS. Times are computed from the quoted rows, not supplied by you.", object({
    caseCode,
    noticeDocumentCode: str("Verified port closure notice to record before the SOF arrives"),
    sofDocumentCode: str("SOF document code (needed for row indexes)"),
    intervals: { type: "array", items: object({ kind: { type: "string", enum: INTERVAL_KINDS }, fromRow: int("SOF row index where it starts"), toRow: int("SOF row index where it ends") }) },
    completionRow: int("SOF row index of completion of loading/discharge"),
    noteRows: { type: "array", items: { type: "integer" }, description: "Row indexes that are context only (arrival, NOR, anchoring, berthing)" },
    arrivalFromAis: bool("Record arrival in port limits from AIS"),
    shiftingFromAis: bool("Record movements after arrival from AIS as SHIFTING"),
  }, ["caseCode"])),
  def("search_customs_portal", "Search official customs hold and release records for the case vessel in a time window.", object({ caseCode, from: str("ISO UTC"), to: str("ISO UTC") })),
  def("verify_hold", "Verify an unverified customs hold on the case with an official release document that covers it.", object({ caseCode, documentCode: str("Customs release document code") })),
  def("get_contract_terms", "Laytime terms from the contract register for one side of the case.", object({ caseCode, side: { type: "string", enum: ["PAYABLE", "RECOVERABLE"] } })),
  def("compute_statement", "Compute and store the laytime statement for one side from recorded facts, register terms and active memory.", object({ caseCode, side: { type: "string", enum: ["PAYABLE", "RECOVERABLE"] } })),
  def("reconcile_invoice", "Reconcile a read owner invoice against the payable statement; stores variances, payable and dispute.", object({ caseCode, documentCode: str("Owner invoice document code") })),
  def("post_accrual", "Post or true up the month-end demurrage accrual for a case (within delegation).", object({ caseCode })),
  def("post_ap", "Approve the reconciled payable: reverse the accrual, post AP and record the dispute. Returns needsAsk when above delegation.", object({ caseCode })),
  def("file_recovery", "File the recovery claim on the cargo counterparty. Returns needsAsk when a decision is required. protective files a protective notice before a time bar.", object({ caseCode, protective: bool("Protective notice before a time bar") }, ["caseCode"])),
  def("create_ask", "Ask a person. The policy decides who. FACT: subject is the interval kind and you write the question (no amounts). PAYMENT and RECOVERY_FILING: the question is generated.", object({
    caseCode, need: { type: "string", enum: ["FACT", "PAYMENT", "RECOVERY_FILING"] },
    subject: { type: "string", enum: [...INTERVAL_KINDS, "PAYMENT", "RECOVERY"] },
    question: str("For FACT: the shortest question, at most 100 characters, no amounts"),
    evidenceDocs: strings("Document codes that give context"),
    contextLineIds: strings("Statement line ids the ask is about"),
  }, ["caseCode", "need", "subject", "question", "evidenceDocs"])),
  def("search_memory", "Learned items: ACTIVE ones apply automatically; PRECEDENT_ONLY ones are context and never rules.", object({ caseCode })),
];

const FLEET_SCAN_TOOLS = new Set(["record_step", "list_fleet", "open_case"]);
const MONTH_END_TOOLS = new Set(["record_step", "list_open_cases", "post_accrual", "get_case_snapshot"]);
const CASELESS_ONLY = new Set(["list_fleet", "list_open_cases", "open_case"]);

/** The tool names a task kind may use (before capability filtering). */
export function toolsForKind(kind: string): Set<string> {
  if (kind === "FLEET_SCAN") return FLEET_SCAN_TOOLS;
  if (kind === "MONTH_END") return MONTH_END_TOOLS;
  return new Set(TOOL_DEFINITIONS.map(tool => tool.name).filter(name => !CASELESS_ONLY.has(name)));
}

/** Minimal JSON-schema check for the subset used above (object, array, string, integer, boolean, enum). */
export function validateInput(schema: unknown, value: unknown, path = "input"): string | null {
  const node = schema as { type?: string; enum?: unknown[]; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; items?: unknown };
  if (node.enum && !node.enum.includes(value)) return `${path} must be one of ${node.enum.join(", ")}`;
  switch (node.type) {
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
      const record = value as Record<string, unknown>;
      for (const key of node.required ?? []) if (record[key] === undefined) return `${path}.${key} is required`;
      for (const [key, item] of Object.entries(record)) {
        const child = node.properties?.[key];
        if (!child) { if (node.additionalProperties === false) return `${path}.${key} is not allowed`; continue; }
        const error = validateInput(child, item, `${path}.${key}`);
        if (error) return error;
      }
      return null;
    }
    case "array":
      if (!Array.isArray(value)) return `${path} must be an array`;
      for (const [index, item] of value.entries()) { const error = validateInput(node.items, item, `${path}[${index}]`); if (error) return error; }
      return null;
    case "string": return typeof value === "string" ? null : `${path} must be a string`;
    case "integer": return Number.isSafeInteger(value) ? null : `${path} must be an integer`;
    case "boolean": return typeof value === "boolean" ? null : `${path} must be a boolean`;
    default: return null;
  }
}

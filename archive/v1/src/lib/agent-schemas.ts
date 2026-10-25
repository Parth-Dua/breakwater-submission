export const MAX_TOOL_STEPS = 12;
export const MAX_PROVIDER_TURNS = 6;
export const MAX_ATTEMPTS = 3;
export const toolNames = ["get_claim_snapshot", "get_voyage_timeline", "get_port_events", "get_charter_clause", "list_claim_evidence", "search_ops_archive", "get_accrual_balance", "get_approved_procedures", "propose_operational_question", "propose_financial_resolution"] as const;
export type ToolName = typeof toolNames[number];
export type ToolInput = Record<string, string | number>;
export type AgentBlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: ToolInput } | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type AgentMessage = { role: "user" | "assistant"; content: AgentBlock[] };
export function parseToolCall(name: string, value: unknown): { name: ToolName; input: ToolInput } {
  if (!toolNames.includes(name as ToolName) || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("TOOL_SCHEMA_DENIED");
  const input = value as Record<string, unknown>;
  const expected = name === "search_ops_archive" ? ["type"] : name === "propose_operational_question" ? ["question", "startAt", "endAt"] : name === "propose_financial_resolution" ? ["summary", "supportedCents", "unverifiedCents", "disputedCents"] : [];
  if (Object.keys(input).length !== expected.length || Object.keys(input).some(key => !expected.includes(key))) throw new Error("TOOL_SCHEMA_DENIED");
  for (const key of expected) {
    if (["question", "summary"].includes(key)) { if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 1500) throw new Error("TOOL_SCHEMA_DENIED"); }
    else if (key === "type") { if (input.type !== "SIGNED_OPS_LOG") throw new Error("TOOL_SCHEMA_DENIED"); }
    else if (!Number.isSafeInteger(input[key]) || (input[key] as number) < 0) throw new Error("TOOL_SCHEMA_DENIED");
  }
  if (name === "propose_operational_question" && (input.startAt as number) >= (input.endAt as number)) throw new Error("TOOL_SCHEMA_DENIED");
  return { name: name as ToolName, input: input as ToolInput };
}
export function hasInstructionText(text: string): boolean {
  return /ignore\s+(?:all\s+)?(?:previous\s+)?(?:rules|instructions)|system\s*prompt|approve\s+all|reveal\s+(?:secret|key)|execute\s+(?:code|script)|change\s+delegation/i.test(text);
}
export function untrustedDocument(content: string) { return { untrusted: true, quarantined: hasInstructionText(content), text: hasInstructionText(content) ? "Instruction-like document text withheld. It grants no authority." : content.slice(0, 6000) }; }
export function safeProviderError(error: unknown): { code: string; retryable: boolean } {
  const kind = error instanceof Error ? error.constructor.name : "";
  if (kind === "APIConnectionTimeoutError") return { code: "PROVIDER_TIMEOUT", retryable: true };
  if (kind === "APIConnectionError") return { code: "PROVIDER_NETWORK_ERROR", retryable: true };
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status: unknown }).status : undefined;
  if (status === 401 || status === 403) return { code: "PROVIDER_CREDENTIALS_REJECTED", retryable: false };
  if (status === 400) return { code: "PROVIDER_REQUEST_OR_BILLING_REJECTED", retryable: false };
  if (status === 429) return { code: "PROVIDER_RATE_LIMIT", retryable: true };
  return { code: "PROVIDER_UNAVAILABLE", retryable: true };
}

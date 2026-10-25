"use node";
// Claude client wrapper (CONTRACTS §10.1). The only module that talks to the Anthropic API.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageParam, BetaTool, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export type Effort = "low" | "medium" | "high";
export type ClaudeRequest = {
  system: string;
  tools?: BetaTool[];
  messages: BetaMessageParam[];
  effort: Effort;
  /** JSON schema for structured output (document extraction). */
  format?: Record<string, unknown>;
  deadlineAt?: number;
  beforeAttempt?: () => Promise<void>;
};
export type Usage = { tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number };
export type ClaudeResponse = { message: BetaMessage; model: string; usage: Usage; ms: number };

/** Injection seam for tests: anything with the beta messages.create shape. */
export interface MessagesClient { create(params: MessageCreateParamsNonStreaming, options?: { timeout: number; signal: AbortSignal }): Promise<BetaMessage> }

let override: MessagesClient | null = null;
export function setMessagesClientForTests(client: MessagesClient | null) { override = client; }

export class ModelUnavailable extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = "MODEL_UNAVAILABLE"; }
}

export class TaskBudgetExceeded extends Error {
  constructor() { super("Task time budget exceeded"); }
}

export const agentModel = () => process.env.BREAKWATER_AGENT_MODEL ?? "claude-sonnet-5-5";
export const isLiveAgent = () => process.env.BREAKWATER_AGENT === "live" || override !== null;

function client(): MessagesClient {
  if (override) return override;
  if (!process.env.ANTHROPIC_API_KEY) throw new ModelUnavailable("ANTHROPIC_API_KEY is not set in the Convex environment");
  // Retries are ours (below) so the task can surface a visible state between attempts.
  const sdk = new Anthropic({ maxRetries: 0, timeout: 60_000 });
  return { create: (params, options) => sdk.beta.messages.create(params, options) };
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const ATTEMPTS = 3;

export async function callClaude(request: ClaudeRequest): Promise<ClaudeResponse> {
  const fast = process.env.BREAKWATER_FAST_MODE === "1";
  if (fast && agentModel() !== "claude-opus-5-5") throw new ModelUnavailable("Fast mode requires the explicit Opus 5.5 override; disable BREAKWATER_FAST_MODE for Sonnet");
  const tools = request.tools?.length
    ? request.tools.map((tool, index) => index === request.tools!.length - 1 ? { ...tool, cache_control: { type: "ephemeral" as const } } : tool)
    : undefined;
  const params: MessageCreateParamsNonStreaming = {
    model: agentModel(),
    max_tokens: 16_000,
    thinking: { type: "adaptive" },
    output_config: { effort: request.effort, ...(request.format ? { format: { type: "json_schema", schema: request.format } } : {}) },
    system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
    messages: request.messages,
    ...(tools ? { tools, tool_choice: { type: "auto" } } : {}),
    betas: ["server-side-fallback-2026-07-01", ...(fast ? ["fast-mode-2026-02-01"] : [])],
    fallbacks: "default",
    ...(fast ? { speed: "fast" as const } : {}),
  };
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const remaining = request.deadlineAt === undefined ? 60_000 : request.deadlineAt - Date.now();
    if (remaining <= 0) throw new TaskBudgetExceeded();
    await request.beforeAttempt?.();
    const timeout = Math.min(60_000, remaining);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    try {
      const message = await Promise.race([
        client().create(params, { timeout, signal: controller.signal }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(request.deadlineAt !== undefined && Date.now() >= request.deadlineAt ? new TaskBudgetExceeded() : new Error("Claude call exceeded 60 seconds")); }, timeout); }),
      ]);
      const usage = message.usage;
      return {
        message, model: message.model, ms: Date.now() - started,
        usage: { tokensIn: usage.input_tokens, tokensOut: usage.output_tokens, cacheRead: usage.cache_read_input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0 },
      };
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number }).status;
      if (error instanceof ModelUnavailable || error instanceof TaskBudgetExceeded) throw error;
      if (status !== undefined && !RETRYABLE.has(status)) throw new ModelUnavailable(`Claude request rejected (${status}): ${String((error as Error).message).slice(0, 300)}`, status);
      if (attempt < ATTEMPTS) await new Promise(resolve => setTimeout(resolve, override ? 10 : 1_000 * 2 ** (attempt - 1)));
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  const status = (lastError as { status?: number }).status;
  throw new ModelUnavailable(`Claude unavailable after ${ATTEMPTS} attempts${status ? ` (${status})` : ""}`, status);
}

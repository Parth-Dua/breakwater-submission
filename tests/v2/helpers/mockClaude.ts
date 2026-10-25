// Hand-scripted Claude responses for runtime tests (no network). Each step sees the request and returns the next message.
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { agentModel, type MessagesClient } from "../../../convex/node/claude";

type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: Record<string, unknown> };
export type MockStep = (params: MessageCreateParamsNonStreaming) => Block[] | Error;

let ids = 0;
export function message(blocks: Block[], stop?: BetaMessage["stop_reason"]): BetaMessage {
  const content = blocks.map(block => block.type === "tool_use" ? { type: "tool_use", id: `toolu_mock_${++ids}`, name: block.name, input: block.input } : { type: "text", text: block.text, citations: null });
  return {
    id: `msg_mock_${++ids}`, type: "message", role: "assistant", model: agentModel(), content,
    stop_reason: stop ?? (blocks.some(block => block.type === "tool_use") ? "tool_use" : "end_turn"), stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as BetaMessage;
}

export const tool = (name: string, input: Record<string, unknown>): Block => ({ type: "tool_use", name, input });
export const text = (value: string): Block => ({ type: "text", text: value });
export const json = (value: unknown): Block => ({ type: "text", text: JSON.stringify(value) });

/** A client that plays the steps in order. `requests` keeps every request for assertions. */
export function scriptedClient(steps: MockStep[]): MessagesClient & { requests: MessageCreateParamsNonStreaming[]; left: () => number } {
  let index = 0;
  const requests: MessageCreateParamsNonStreaming[] = [];
  return {
    requests, left: () => steps.length - index,
    async create(params) {
      requests.push(params);
      const step = steps[index++];
      if (!step) throw Object.assign(new Error("mock script exhausted"), { status: 400 });
      const out = step(params);
      if (out instanceof Error) throw out;
      return message(out);
    },
  };
}

/** The last tool_result content in a request, parsed. */
export function lastToolResult(params: MessageCreateParamsNonStreaming): unknown {
  const last = params.messages[params.messages.length - 1];
  const blocks = Array.isArray(last.content) ? last.content : [];
  const result = [...blocks].reverse().find(block => (block as { type: string }).type === "tool_result") as { content?: string } | undefined;
  return result?.content ? JSON.parse(result.content) : undefined;
}

export const overloaded = () => Object.assign(new Error("Overloaded"), { status: 529 });

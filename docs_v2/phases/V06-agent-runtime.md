# V06 — Agent Runtime (Claude), Tools, Steps, Asks

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 6 h · **Depends on:** V05
**Requirements:** REQ-AGT-01..07, REQ-SRC-02..03, CONTRACTS §9–10, ARCHITECTURE §5–6
**External:** `ANTHROPIC_API_KEY` in the Convex env (already present). Live checks are reported separately.

## Objective
A real Claude agent that picks up world events, uses only its capabilities, shows its steps live, keeps money in the engine, and asks the right role at the right moment.

## Sequence
1. Load the `claude-api` reference before writing SDK code. Upgrade `@anthropic-ai/sdk` if needed for `output_config`, strict tools and the `fallbacks` beta. Verify every parameter in CONTRACTS §10.1 against the installed SDK types.
2. `convex/node/claude.ts`: a client wrapper with the exact parameters, prompt caching, typed error mapping (`MODEL_UNAVAILABLE`), token accounting, and a model-served label (fallback aware). Provider injection for tests (`MessagesClient` interface).
3. `convex/node/prompts/agent.ts`: frozen system prompt (CONTRACTS §10.2).
4. Tools (CONTRACTS §10.3) in `convex/node/tools/*.ts`: JSON schemas with `strict: true`, `additionalProperties: false`; handlers call the V03 sources and V05 engines/gateway; each logs a `ToolCallLog`; `canUse` is checked before every call.
5. `read_document`: send the PDF as a base64 document block with the kind-specific extraction tool. Verify quotes against `textLayer`; one repair turn for rejected fields.
6. `node/agent.runTask`: lease, capabilities, context build, loop limits, `record_step` streaming to `agentSteps`, postcondition verifier with one repair turn, final task state.
7. Orchestrator: map events to tasks (ARCHITECTURE §5.1); `ASK_ANSWERED` tasks; reminder job for asks older than 7 sim days (`ASK_REMINDER_SENT`); `DEADLINE_CHECK` with fallback.
8. Asks: `gateway.createAsk` routing by `routeAsk`; `gatesClock` true for PAYMENT_APPROVAL and COMMERCIAL_DECISION, false for CONFIRM_FACT unless the next scripted event depends on it.
9. Recorded transcripts for mocks: run each task kind live once, save sanitized transcripts to `fixtures/agent-transcripts/`, and use them in integration tests (T-05…T-09, T-11, T-14, T-16, T-22, T-24).
10. Live checks (`scripts/live/agent-smoke.ts`): one real run per task kind on a `test-live` namespace copy of Aster Vale. Report tokens, latency, cache reads, and postconditions met.
11. Complete `demo:prepare`: run Kestrel and Halden Star with the real agent to their stopping states; store the baseline.

## Required artifacts
`convex/node/claude.ts`, `convex/node/prompts/agent.ts`, `convex/node/tools/**`, `convex/node/agent.ts`, `convex/orchestrator.ts`, `fixtures/agent-transcripts/**`, `tests/v2/integration/agent.test.ts`, `scripts/live/agent-smoke.ts`.

## Acceptance
- [ ] Integration tests pass with mocks; S-04–S-07 pass.
- [ ] Live: each task kind succeeds on real Claude with postconditions met; `cache_read_input_tokens > 0` observed after the first task.
- [ ] `demo:prepare` produces Kestrel "Waiting · Ops" with ask K-1 and a reminder, and Halden "Awaiting invoice". Verified by query.
- [ ] No monetary value in any step comes from model text (statement values are engine-only; checked by test).
- [ ] `npm run gate -- V06` passes; live results recorded separately.

## Failure policy
If the model skips required checks, fix prompts, tools or postconditions. Never hardcode outcomes or branch on case codes.

## User-authorized evidence reuse (2026-10-24)

The user explicitly requested advancement without another V06 live run because API credits are limited. V06 may be accepted using the completed seven-kind Opus 5.5 run with exact financial assertions, final-code transcript replay and deterministic/security tests, plus the actual ten-task Sonnet 5.5 local baseline (9 SUCCEEDED, 1 WAITING_HUMAN). `fixtures/agent-transcripts/acceptance.json` records this exception; `sonnet-baseline.json` contains sanitized actual read-back evidence.

At initial V06 acceptance the full seven-kind Sonnet storm run had been interrupted and was **NOT_RUN / unverified**. Never relabel Opus evidence as Sonnet. The gate must report that limitation separately, reuse the recorded evidence with `--reuse-live`, and make no replacement provider calls. Other V06 acceptance checks remain required. This amendment authorizes V07 advancement; it does not claim full Sonnet storm verification.

### Subsequent resolution during V07
The user requested a background Sonnet storm run. It completed successfully on 2026-10-24 (Pacific): 17 real Sonnet tasks cover all seven kinds, with exact financial/ask assertions and cache reads. Recorded prepare setup was explicitly excluded from live metrics; the deployment baseline was separately verified on Sonnet. The current `live-report.json` resolves the earlier limitation without relabeling historical Opus transcripts.

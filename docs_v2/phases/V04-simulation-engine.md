# V04 — Simulation Engine, Disruption, Reset

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 3 h · **Depends on:** V03
**Requirements:** REQ-SIM-01..03, ARCHITECTURE §4

## Objective
A deterministic, event-driven company clock that releases the world script only when the agent is idle, holds for gating asks, and resets in seconds.

## Sequence
1. Tables `simClock`, `worldScripts`, `worldEvents`, `baselineSnapshots` (CONTRACTS §3).
2. `convex/sim.ts`: `startDisruption` (idempotent; anchors `RTM-STORM-2026-10` at `simNow`), `tick` (internal scheduled loop per ARCHITECTURE §4), `letTimePass`, `setPacing`, query `clock`.
3. Event release writers: each `WorldEventType` writes its source records (AIS points, mail message + document link, customs record, port notice) and calls `orchestrator.onWorldEvent` (enqueues `agentTasks` rows for the V06 runtime).
4. `demo:prepare` CLI (`scripts/demo/prepare.ts` → Convex internal actions): reset ns `demo`, import, run the Kestrel and Halden scripts (the agent is required. Until V06, prepare stops after import and is marked incomplete), set the clock, store the baseline snapshot.
5. `demo.reset` mutation: restore from the latest baseline snapshot; append `NAMESPACE_RESET` to the audit chain (the chain arrives in V05; until then, a plain audit row).
6. Tests T-01–T-04 (with a fake agent that completes tasks instantly), T-21, T-25.

## Required artifacts
`convex/sim.ts`, `convex/world/release.ts`, `convex/orchestrator.ts` (enqueue only), `scripts/demo/prepare.ts`, `convex/demo.ts`, `tests/v2/integration/sim.test.ts`.

## Acceptance
- [ ] With a fake agent, the full RTM script releases 16 events in order, and the clock ends at 12-09 10:00.
- [ ] HELD and "let time pass" behave per T-04.
- [ ] Reset restores the baseline; other namespaces are untouched.
- [ ] `npm run gate -- V04` passes.

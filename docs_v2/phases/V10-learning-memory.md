# V10 — Learning: Trace Diff, Classifier, Memory Gate, Backtest

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 6 h · **Depends on:** V09
**Requirements:** REQ-LRN-01..07, LEARNING.md (all)
**External:** Jev credentials in Convex: `TYPESAFE_API_KEY` for TypeSafe, or `OPENROUTER_API_KEY` with `BREAKWATER_JEV_TRANSPORT=openrouter`.

## Objective
Turn human answers into governed memory: learn what the agent was missing, refuse to learn commercial judgment, and show both visibly.

## Sequence
1. Pure modules: `src/domain/diff.ts` (provenance chain + diff types), `src/domain/memory-gate.ts`, `src/domain/backtest.ts`, `src/domain/precedent-search.ts`.
2. `convex/node/lessons.ts`: build the lesson JSON (deterministic fields) + a Claude draft of `lesson_text`/`proposed_payload` (effort high, strict tool), validated against the payload whitelist and diff consistency.
3. Classifier (`convex/node/classifier/`): `index.ts` (interface + `getClassifier`), `jev.ts` (LEARNING §4.3; install `@langchain/typesafe`; read its README in `node_modules` to confirm option names; never call without a key). Persist `classifierCalls`.
4. Learning pipeline `convex/learning.ts`: `processAnswer(askId)` → diff → lesson → classify → gate → memory item → teach-back ask and/or backtest → Controller `APPROVE_MEMORY` ask. Idempotent per ask.
5. Memory consumption: `computeStatement` receives overrides from ACTIVE `CONTRACT_RULE_OVERRIDE` items; `resolveCapabilities` grants from ACTIVE procedures; usage tracking (`usedIn`, `memoryRefs`).
6. Memory UI completion: the expanded item (what changed, decision, backtest, approval, used in), PRECEDENT styling, Controller inline Approve/Reject, NEW badge.
7. Calibration: `fixtures/learning/calibration.json` (40 items) and `npm run learning:calibrate`.
8. Tests L-01–L-10, T-17–T-19, T-23, U-20. Live: Kestrel → procedure ACTIVE → Aster Vale uses it (T-08 live).

## Required artifacts
`src/domain/{diff,memory-gate,backtest,precedent-search}.ts`, `convex/node/lessons.ts`, `convex/node/classifier/{index,jev}.ts`, `convex/learning.ts`, `convex/memory.ts`, `fixtures/learning/calibration.json`, `fixtures/classifier/jev-response.sample.json`, `tests/v2/integration/learning.test.ts`.

## Acceptance
- [ ] All three WORLD learning outcomes happen live (procedure ACTIVE after the Controller; fact ACTIVE via Controller teach-back; precedent not learned).
- [ ] Aster Vale shows "Used memory" and raises no Ops ask.
- [ ] Jev adapter contract test passes. If a key exists: one live classification and a calibration run are recorded.
- [ ] Required phase checks and separately reported live Jev evidence validate the current source.

## Failure policy
No ID-based branches. No "learned" item without a persisted classifier call. A missing Jev key or failing service call records ERROR and leaves memory in NEEDS_REVIEW. Activation requires a persisted successful Jev response.

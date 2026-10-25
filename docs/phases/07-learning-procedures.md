# Phase 07 — Episodic Learning and Tested Procedural Memory

**Status:** BLOCKED | **Estimate:** 4 h
**Depends on:** Accepted Phase 06
**Requirements:** REQ-LEARN-01..04, REQ-LEARN-06, REQ-LEARN-07

## Objective
Convert actual observed human work into a source-linked episode and safe executable procedure candidate.

## Implementation sequence
1. On completed session, schedule reconstruction with ordered events and linked evidence.
2. Call Claude with bounded context and schema-validated output.
3. Store observed steps, explicit findings, inferred rationale, and uncertainties separately.
4. Classify potentially overlapping factual correction, investigation procedure, one-time exception, and governance request.
5. Run generalization gate checking intent, scope, evidence quality, counterexamples, and authority.
6. Implement whitelisted DSL validator and generic interpreter in pure domain code.
7. Implement structured scope matcher and authorized archive-search operation.
8. Generate candidate through generic allocator; seeded historical IDs allow demo candidate P-009.
9. Run at least two positive and three negative fixtures plus wrong-voyage, unsigned, missing log, CH-BETA, and unknown charter.
10. Persist actual test report with expected/actual outcomes.
11. Reject unsafe, invalid, or overly broad candidates; no arbitrary generated JavaScript.
12. Create Controller review task only for ready candidate.
13. Ensure one-off goodwill exception stays non-executable.
14. Verify P-009 remains inactive before approval.

## Required artifacts
`convex/internal/learning.ts`, `convex/internal/procedures.ts`, `src/domain/procedures.ts`, `src/lib/episode-schema.ts`, `src/lib/procedure-schema.ts`, `tests/integration/memory.test.ts`.

## Acceptance criteria
- [ ] Actual V-203 session produces source-linked episode.
- [x] Observed/inferred reasoning is distinguished.
- [x] Candidate generated only after session completion.
- [x] DSL is schema-valid and runs through generic interpreter.
- [x] Positive and negative test report persists.
- [x] CH-BETA is evaluated dynamically; no copied exclusion.
- [x] Candidate remains inactive until Controller approval.
- [x] One-off exception cannot activate.
- [x] No code branches on P-009 or V-203/V-204 IDs.
- [ ] `npm run gate -- 07` passes.

## Failure policy
No self-approval, blanket customs rule, fabricated passing tests, or arbitrary code execution.

## Exit
Commit/push implementation and checkpoint; advance to Phase 08.

## Current external blocker (2026-10-24)
Implementation and automated/provider checks pass. The final live-human acceptance check reports `GENUINE_COMPLETED_OPERATIONS_SESSION_REQUIRED`; no actual human session or candidate has been fabricated. Complete the pending Operations review in the local preview, verify its live reconstruction/test report, and rerun gate07 before acceptance or Phase08.

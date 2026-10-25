# V11 — Proof: Why?, Scoreboard, Calibration, Real vs Simulated

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 4 h · **Depends on:** V10
**Requirements:** REQ-AUD-02, REQ-PRF-01..02, TEST_MATRIX §6

## Objective
Evidence up front: every number explains itself, and the system has a measured score on data it never saw.

## Sequence
1. `explain.why` (Node action): provenance graph → Claude phrasing (effort low) with citation validation and deterministic fallback; cache in `explanations`. Test T-26 (mock + one live).
2. `npm run score:run`: run the real agent on 24 `score` voyages with the scripted responder; compute TEST_MATRIX §6 metrics; persist `scoreRuns`. Budget check before running: print the estimated token cost and require `--yes`.
3. Proof tab: scoreboard block (latest run only, with model/date/voyages), per-voyage drill-down; no classifier/provider/calibration block (explicit user UI override, 25 Oct 2026); real vs simulated list (UI §4.4); audit chain block with `Verify now`.
4. Screenshot U-10.

## Required artifacts
`convex/node/explain.ts`, `scripts/score/run.ts`, `convex/proof.ts`, `src/features/desk/ProofTab.tsx` (complete), `tests/v2/integration/explain.test.ts`.

## Acceptance
- [ ] A scoreboard run is recorded with real metrics (whatever they are). Failures are visible and documented in progress.md, not hidden.
- [ ] Why? answers cite only provenance IDs.
- [ ] `npm run gate -- V11 --reuse-live` passes: 125 tests, 22 Chrome checks; verified 2026-10-25T09:02:38.186Z.

Validation is not run for this source snapshot. Any future score must come from an actual recorded run.

# Phase 08 — Controller Approval, Memory Explorer, and Ledger

**Status:** IMPLEMENTED — LIVE ACCEPTANCE BLOCKED | **Estimate:** 3 h
**Depends on:** Accepted Phase 07
**Requirements:** REQ-LEARN-05, REQ-LEARN-06, REQ-LEARN-08, REQ-FIN-02..04, REQ-UI-04, REQ-UI-05

## Objective
Complete the controlled learning loop and display real accounting outcomes.

## Implementation sequence
1. Implement Controller queue and procedure candidate review.
2. Show source episode, observed actions, inferred steps, typed DSL, scope, counterexamples, and test report.
3. Implement approve, reject, narrow-and-retest, request-evidence, and revoke actions.
4. Validate Controller role, candidate revision, and test report on the server.
5. Atomically activate approved version; revocation blocks future execution.
6. Build Memory Explorer with approved, proposed, case-specific, and revoked tabs.
7. Show real provenance, approval, version, executions, and before/after run comparison.
8. Run unseen V-204 after approval; verify authorized signed archive search and no Operations task.
9. Run CH-BETA V-205; verify independent charter treatment.
10. Add synthetic revised $10k invoice to V-203 only through scenario/source workflow.
11. Use financial gateway to clear $15k accrual and recognize $10k AP.
12. Build journal list/detail, accrual, AP, and accounting-period views.
13. Add integration tests for approval, scope, revocation, ledger, and replay.

## Required artifacts
`src/features/controller/ProcedureReview.tsx`, `src/features/memory/MemoryExplorer.tsx`, `ProcedureDetail.tsx`, `src/features/finance/LedgerView.tsx`, `convex/memories.ts`, `convex/finance.ts`, `tests/integration/approval-posting.test.ts`.

## Acceptance criteria
- [x] Only Controller can activate candidate.
- [x] Approval stores actor, version, scope, and test report.
- [x] Rejection keeps candidate inactive; narrowing retests.
- [x] Revocation blocks new executions.
- [ ] V-204 uses approved procedure without repeat escalation.
- [ ] V-205 follows CH-BETA treatment.
- [x] Revised invoice required before AP posting.
- [ ] $15k reversal and $10k invoice journals balance.
- [x] Memory before/after uses real recorded runs.
- [ ] `npm run gate -- 08` passes.

## Failure policy
No static before/after claims, UI-only approval, or model-authorized posting.

## Exit
Commit/push implementation and checkpoint; advance to Phase 09.

## Execution decision
User explicitly requested Phase08 on2026-10-24 while07 remains blocked on genuine human review. Implementation may proceed under that later instruction;07 and08 acceptance/release evidence must remain truthful.

Implementation-level criteria above are covered by mocked integration tests and actual read-only UI checks. Actual human approval, default unseen/BETA execution and AP posting remain explicit live acceptance requirements; no mocked result satisfies them.

Final gate08 on2026-10-24T23:28:12.810Z exited1 at the genuine-human learning check. All software/UI/provider checks passed (55 local tests,11 Chrome tests). Actual Controller approval, unseen/BETA execution and revised-invoice AP proof remain pending release gates.

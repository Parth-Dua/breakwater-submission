# Phase 09 — Audit, Scenario Injection, and Adversarial Verification

**Status:** IMPLEMENTED / LIVE ACCEPTANCE PENDING | **Estimate:** 3 h
**Depends on:** Accepted Phase 08
**Requirements:** REQ-LEARN-08, REQ-FIN-03, REQ-SYS-02..04, REQ-UI-05

## Objective
Prove the system behaves correctly under altered conditions, failure, and attempted authority bypass.

## Implementation sequence
1. Build chronological Audit Trail with actor, role, entity, correlation ID, evidence, and before/after state.
2. Link audit entries to claims, procedures, work sessions, and journals.
3. Build demo-admin-only scenario injector and isolated idempotent reset.
4. Support source-level injections: different charter, missing log, conflicting notice, late evidence, revoked procedure, duplicate invoice, locked period.
5. Injector may change synthetic **inputs**, never write final successful outcomes.
6. Implement complete F01–F20 fixture matrix and negative RBAC tests.
7. Add malicious document instruction test, retry/idempotency test, and locked-period posting test.
8. Implement reopening after late evidence; never mutate posted journal lines.
9. Add adjustment proposal for financial impact of reopened case.
10. Add Playwright end-to-end canonical learning flow.
11. Verify reset preserves unrelated scenario/audit data.
12. Run full regression and record actual fixture results.

## Required artifacts
`src/features/audit/AuditTrail.tsx`, `src/features/scenarios/ScenarioControls.tsx`, `convex/audit.ts`, `convex/scenarios.ts`, `tests/e2e/judge-scenarios.spec.ts`, full fixture tests.

## Acceptance criteria
- [ ] Every material state transition has an audit record.
- [ ] Scenario controls require demo-admin authorization.
- [ ] Reset restores baseline and removes P-009 from active baseline.
- [ ] CH-BETA case remains safe.
- [ ] Duplicate events never duplicate journals.
- [ ] Late evidence reopens and proposes adjustment, not history rewrite.
- [ ] Revoked procedure does not execute.
- [ ] F01–F20 all pass.
- [ ] E2E canonical workflow passes.
- [ ] `npm run gate -- 09` passes.

## Failure policy
No disabling auth, wiping unrelated audit history, or direct scenario writes to final outcomes.

## Exit
Commit/push implementation and checkpoint; advance to Phase 10.

## Execution decision
Independent implementation proceeds after verified08 software/provider checks and push, with07/08 genuine-human acceptance explicitly pending per explicit user instruction to continue building with live proof pending. No final release or phase acceptance may be asserted from mocked evidence.

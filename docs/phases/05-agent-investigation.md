# Phase 05 — Live Claude Investigation and Durable Escalation

**Status:** ACCEPTED | **Estimate:** 4 h
**Depends on:** Accepted Phase 04
**Requirements:** REQ-CLAIM-04, REQ-CLAIM-05, REQ-SYS-01, REQ-SYS-02
**External dependency:** Valid `ANTHROPIC_API_KEY` in Convex server environment.

## Objective
Run a real Claude-driven, tool-using investigation that preserves uncertainty and requests the correct human fact.

## Implementation sequence
1. Configure Anthropic SDK only in Convex server-side actions.
2. Define schema-validated typed tools for claim, AIS, port, charter, evidence, accrual, and approved procedures.
3. Add tool authorization: claim packet is readable; wider Operations archive search requires approved scoped procedure or human Operations role.
4. Implement bounded tool-call loop, step budget, and safe structured response parsing.
5. Persist agent runs, correlation IDs, tool outcomes, evidence references, and retry state.
6. Implement deterministic reconciliation after evidence retrieval.
7. Create precise Operations work item for missing 48h cause.
8. Ensure escalation creation is idempotent by claim revision and question.
9. Implement scheduled resume, bounded retry, and terminal failure visibility.
10. Treat source documents as untrusted input; reject instruction-like content.
11. Add mocked deterministic integration tests and one **actual live Claude smoke test**.
12. Confirm no posting occurs for disputed/unverified invoice amount.

## Required artifacts
`convex/internal/agent.ts`, `convex/internal/workflow.ts`, `src/lib/agent-tools.ts`, `src/lib/agent-schemas.ts`, `tests/integration/investigation.test.ts`.

## Acceptance criteria
- [x] Real Anthropic API call succeeds; result is logged without secrets.
- [x] Typed tool validation and access checks execute.
- [x] V-203 is $10k supported and $20k unverified.
- [x] Exactly one Operations task asks for cause of 48h.
- [x] Agent does not access unapproved wider archive.
- [x] Agent does not post unsupported amount.
- [x] Retries do not duplicate tasks or journals.
- [x] Workflow resumes from persisted state.
- [x] Prompt injection fixture F12 is safe.
- [x] `npm run gate -- 05` passes, including separately reported live smoke.

## Failure policy
Missing key => BLOCKED, not mock success. No hidden direct finance mutation from Claude.

## Exit
Commit/push implementation and checkpoint; advance to Phase 06.

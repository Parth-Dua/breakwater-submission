# Phase 03 — Authentication, Authorization, and Financial Engine

**Status:** ACCEPTED | **Estimate:** 3 h
**Depends on:** Accepted Phase 02
**Requirements:** REQ-FIN-01..05, REQ-SYS-01

## Objective
Make financial correctness and role separation enforceable before enabling autonomous actions.

## Implementation sequence
1. Configure Convex Auth and real Operations/Controller demo identities.
2. Store roles server-side and implement reusable authorization helpers.
3. Reject client-supplied role escalation in every sensitive mutation.
4. Implement pure integer-cents math, half-up rounding, interval validation, and charter eligibility.
5. Reject unknown causes, wrong charter versions, overlapping intervals, and invalid evidence references.
6. Implement balanced journal validation, valid accounts, open/locked periods, immutable posted lines.
7. Seed delegated invoice limit $12k and accrual-clearing limit $20k with explicit conditions.
8. Implement internal-only financial posting gateway and idempotency keys.
9. Atomically create journal and audit records.
10. Test original $15k accrual, correct reversal, and $10k accepted invoice.
11. Implement Controller financial proposal approval path without granting Operations access.
12. Add negative auth, locked period, duplicate posting, and rounding tests.

## Required artifacts
`convex/auth.ts`, `convex/finance.ts`, `convex/internal/ledger.ts`, `src/domain/money.ts`, `src/domain/charters.ts`, `src/domain/ledger.ts`, `tests/domain/finance.test.ts`, `tests/security/rbac.test.ts`.

## Acceptance criteria
- [x] Operations cannot post journals or approve procedures.
- [x] Agent cannot change delegation.
- [x] Every journal balances and uses integer cents.
- [x] 90 min at $10k/day equals 62,500 cents.
- [x] Duplicate posting returns same result without new lines.
- [x] Locked-period posting is rejected.
- [x] Accrual reversal signs are correct.
- [x] Valid source invoice and authorization required.
- [x] No payment execution endpoint exists.
- [x] `npm run gate -- 03` passes.

## Failure policy
No client-only RBAC, floating-point accounting, arbitrary public journal mutation, or weakening of financial tests.

## Exit
Commit and push implementation/checkpoint; advance to Phase 04.

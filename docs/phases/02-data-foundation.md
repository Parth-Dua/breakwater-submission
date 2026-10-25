# Phase 02 — Convex Schema and Synthetic Enterprise Data

**Status:** ACCEPTED | **Estimate:** 3 h
**Depends on:** Accepted Phase 01
**Requirements:** REQ-CLAIM-01, REQ-CLAIM-02, REQ-SYS-03

## Objective
Create realistic, internally consistent, persistent records driving every subsequent workflow.

## Implementation sequence
1. Implement all tables, validators, and indexes defined in `docs/CONTRACTS.md`.
2. Create versioned, idempotent synthetic seed and isolated demo scenario namespace.
3. Seed at least 12 voyages covering F01–F20 requirements, with internally consistent invoices, charters, AIS, notices, logs, accruals.
4. Seed V-203: 72h, $30k claim, 24h official closure, 48h unexplained.
5. Store signed customs log in Operations archive, **not linked** to initial claim packet.
6. Seed V-204 as held-out case and V-205 with different CH-BETA treatment.
7. Seed P-001/P-002 approved and P-003–P-008 archived historical procedure IDs; P-009 must not exist in active baseline.
8. Seed historical episodes H-011/H-012 and synthetic governance delegations.
9. Validate charter effective dates, evidence voyage links, nonoverlapping intervals, chronological AIS, and balanced accruals.
10. Implement read-only Convex claim/voyage queries.
11. Implement repeatable reset that affects only isolated demo records.
12. Write integrity and idempotent seed tests.

## Required artifacts
`convex/schema.ts`, `convex/seed.ts`, `convex/claims.ts`, `convex/voyages.ts`, `src/domain/intervals.ts`, `src/domain/claims.ts`, `tests/domain/fixtures.test.ts`.

## Acceptance criteria
- [x] Seed creates >=12 voyages and necessary fixtures.
- [x] V-203 initial amounts equal 3,000,000/1,000,000/2,000,000/0 cents.
- [x] Signed log exists but is not in initial claim evidence.
- [x] CH-ALPHA and CH-BETA have different customs treatment.
- [x] P-009 not active or precreated as approved.
- [x] Repeated seed does not duplicate records.
- [x] Reset restores identical baseline.
- [x] All sources visibly marked synthetic.
- [x] Fixture integrity tests and `npm run gate -- 02` pass.

## Failure policy
No UI-only mock records or demo-specific outcome branches. Correct inconsistent source data rather than relaxing integrity tests.

## Exit
Commit/push verified implementation and checkpoint; advance to Phase 03.

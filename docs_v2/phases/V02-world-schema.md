# V02 — v2 Schema, World Generators, History

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 4 h · **Depends on:** V01
**Requirements:** REQ-SIM-04, REQ-SRC-01, WORLD §1–3, §7, §9

## Objective
Persist the simulated company exactly as WORLD.md defines it, deterministically, in the v2 schema.

## Sequence
1. Deployment: the local Convex deployment (MIGRATION §4). v1 cloud data is untouched.
2. Implement all CONTRACTS §3 tables with validators and indexes (`convex/schema.ts`). Remove the v1 tables.
3. Pure world definitions in `src/world/`: `company.ts` (personas, counterparties, ports + geofences, fleet), `contracts.ts` (terms exactly per WORLD §3, including the planted register omission for cl. 8), `policies.ts` (WORLD §9), `scripts/rtmStorm.ts` and `scripts/kestrel.ts` and `scripts/halden.ts` (event lists with payload references).
4. `scripts/world/generate-history.ts` (seed `MERIDIAN-2026-H1`): 32 closed cases with AIS, SOF rows, invoices, statements (computed with the V05 engine once it exists; until then the generator writes the ground-truth statement it constructs), outcomes and journals. Write JSON to `fixtures/world/history.json`.
5. `scripts/world/generate-scoreboard.ts` (seed `SCORE-2026`): 24 voyages + answer key → `fixtures/world/scoreboard.json`.
6. `convex/world/import.ts` (internal): idempotent import of company, contracts, policies, periods (Jan–Sep LOCKED; Oct, Nov, Dec OPEN; Oct `lockAt` 11-03 00:00) and history into ns `demo`. Scoreboard voyages go into ns `score`.
7. Integrity checks (tests): geofence polygons closed; AIS chronological; SOF rows map to UTC via `localToUtc` (implemented by V05); journals balance per period; planted pattern counts (W-30); determinism (W-31).

## Required artifacts
`convex/schema.ts`, `src/world/**`, `scripts/world/generate-history.ts`, `scripts/world/generate-scoreboard.ts`, `fixtures/world/*.json`, `convex/world/import.ts`, `tests/v2/domain/world.test.ts`.

## Acceptance
- [ ] The v2 schema is deployed to the local deployment.
- [ ] The import is idempotent (second run: zero inserts).
- [ ] W-30, W-31 pass.
- [ ] Every record has `ns` and `origin`.
- [ ] `npm run gate -- V02` passes.

# V05 — Deterministic Engines, Gateway, Audit Chain

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 5 h · **Depends on:** V04
**Requirements:** REQ-AGT-03, REQ-FIN-01..06, REQ-AUD-01, CONTRACTS §5, §7, §8

## Objective
Every number in WORLD.md comes out of pure, tested code before any model is involved.

## Sequence
1. Install `luxon` and `@noble/hashes`.
2. Implement CONTRACTS §5 modules in `src/domain/`: `money`, `time` (DST-aware, including ambiguous-hour `fold`), `geo`, `nor`, `laytime` (rules in the signature comments), `reconcile`, `ledger` (v2 accounts), `policy`, `capabilities` (resolution only; tools in V06), `postconditions`, `provenance`.
3. Gateway (`convex/gateway.ts`, internal only): `postJournal`, `fileRecoveryClaim`, `recordDispute`, `createAsk`, `applyAskAnswer`, `activateMemory`. Each validates per ARCHITECTURE §7 and writes the audit event atomically.
4. Audit chain (`convex/audit.ts`): `appendAudit(ctx, event)` computes `seq`, `prevHash`, `hash` (sha256 over canonical JSON). `verifyChain` query. Migrate all writers to `appendAudit`.
5. Month-end and period-lock system handlers use `ledger.buildAccrual` and `validateJournal`.
6. Tests: all W-01…W-15 and W-20…W-26 on WORLD data; T-10; S-08; T-27 (including a tamper test in `convex-test`).

## Required artifacts
`src/domain/{money,time,geo,nor,laytime,reconcile,ledger,policy,capabilities,postconditions,provenance}.ts`, `convex/gateway.ts`, `convex/audit.ts`, `tests/v2/domain/*.test.ts`, `tests/v2/integration/gateway.test.ts`.

## Acceptance
- [ ] Every answer-key number reproduces exactly.
- [ ] Journals cannot be posted outside the gateway; the chain verifies; tamper is detected.
- [ ] `npm run gate -- V05` passes.

## Failure policy
If an engine result disagrees with WORLD.md, stop. Find which is wrong, and record any spec correction for user approval. Never adjust the test to match the code.

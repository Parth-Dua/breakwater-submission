# V07 — Desk

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 3 h · **Depends on:** V06
**Requirements:** REQ-UI-01..05, UI §4

## Objective
The company at a glance: KPI strip, live cases, books, the proof placeholder, and the people the agent is waiting on.

## Sequence
1. Queries `desk.summary`, `desk.cases`, `desk.waitingOnPeople`, `desk.learnedRecently`, `books.trialBalance`, `books.journals` (CONTRACTS §11). All money values come from these queries.
2. Components `src/features/desk/`: `KpiStrip`, `CasesTable` (live status line, row insert animation, closed group), `BooksTab` (trial balance, journals with inline expansion, periods row), `ProofTab` (placeholder blocks until V11, labeled "Not run yet"), `WaitingOnPeople`, `LearnedList`.
3. `⚡ New disruption` wired to `sim.startDisruption`; disabled while active.
4. `Answer as <Role>` flow: set the persona, then navigate to the case.
5. E2E: U-14 (live), U-11/U-12/U-13-equivalent on the Desk, screenshots U-01, U-02.

## Required artifacts
`src/app/page.tsx`, `src/features/desk/**`, `convex/desk.ts`, `convex/books.ts`, `tests/v2/e2e/desk.spec.ts`.

## Acceptance
- [ ] The baseline Desk matches the prepared state (Kestrel waiting · Ops, Halden awaiting invoice, 32 closed).
- [ ] Pressing ⚡ adds a working Aster Vale row live.
- [ ] The Books trial balance shows balanced.
- [ ] Screenshots reviewed; `npm run gate -- V07` passes.

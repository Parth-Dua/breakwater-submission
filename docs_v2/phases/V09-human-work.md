# V09 — Human Work Surfaces and Observation

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 5 h · **Depends on:** V08
**Requirements:** REQ-HUM-01..03, UI §7–8, CONTRACTS §8

## Objective
Each human role does real work in the same room. Every action that matters is captured as a typed event, and the answer resumes the agent.

## Sequence
1. `OpsDesk` (UI §8.1): source switcher (Mailbox, Customs portal, Documents), search, results, pdf preview, Link/Unlink, structured answer (Confirm / Different cause / Can't find), Submit. Mutations `sources.search`, `sources.openDocument`, `asks.linkEvidence`, `asks.answer`. Each writes `humanEvents` in order (server-side seq).
2. `StatementEditor` (UI §8.2): treatment select per line; required basis (clause select from the case contracts + note); `statements.editLine` creates a draft edit and returns the recomputed totals from the engine; Approve/Reject call `asks.answer` with `editIds`.
3. `RecoveryDecision` (UI §8.3): Pursue / Partial (amount + reason) / Waive (reason).
4. `TeachBackCard` in the rail (UI §7), backed by `TEACH_BACK` asks (created in V10; render support now).
5. After submit: center stage → MAP, persona → Observer, the agent's `ASK_ANSWERED` task runs (live).
6. Permissions: S-03 tests; hidden affordances for other roles.
7. Tests: U-16, T-12, T-13 (with let-time-pass), T-15 (mock path).

## Required artifacts
`src/features/work/{OpsDesk,StatementEditor,RecoveryDecision,TeachBackCard}.tsx`, `convex/asks.ts`, `convex/statements.ts`, `convex/sources/humanSearch.ts`, `tests/v2/integration/human-work.test.ts`, `tests/v2/e2e/human-work.spec.ts`.

## Acceptance
- [ ] Kestrel Ops flow works end-to-end (live), producing exactly the expected event sequence.
- [ ] The Controller edit changes totals live and approval posts journals via the gateway.
- [ ] The Trader partial files $90,600 (live, after the Aster Vale run reaches A-1).
- [ ] `npm run gate -- V09` passes.

The integrated V09 live browser scenario also asserts U-14 Desk pickup and U-03 live NOW/NOR behavior, so those earlier standalone provider runs are skipped when this scenario runs. The procedure capability is an explicitly labeled AUTOMATED_TEST seed until V10; no human learning is claimed.

# Breakwater — Specification Index (v1, SUPERSEDED)

> **Superseded on 2026-10-24 by [`docs_v2/`](../docs_v2/README.md).** This v1 spec (delay-claim analyst) is frozen history. Do not implement from it.

This directory was the authoritative, version-controlled specification for the Breakwater CalHacks / Hyphenate project.

## Directory structure

~~~text
breakwater/
├── AGENTS.md
├── progress.md
└── docs/
    ├── README.md
    ├── PRD.md
    ├── ARCHITECTURE.md
    ├── CONTRACTS.md
    ├── UI.md
    ├── TEST_MATRIX.md
    ├── DEMO.md
    └── phases/
        ├── 00-repository-toolchain.md
        ├── 01-design-system.md
        ├── 02-data-foundation.md
        ├── 03-auth-finance.md
        ├── 04-vessel-time-machine.md
        ├── 05-agent-investigation.md
        ├── 06-human-observation.md
        ├── 07-learning-procedures.md
        ├── 08-approvals-ledger.md
        ├── 09-audit-adversarial.md
        └── 10-deployment-release.md
~~~

## Specification precedence

1. `PRD.md` establishes product intent, scope, and business outcomes.
2. `CONTRACTS.md` establishes domain invariants, schemas, permissions, and API boundaries.
3. `ARCHITECTURE.md` establishes component responsibilities and orchestration.
4. `UI.md` establishes interaction and visual acceptance.
5. `TEST_MATRIX.md` establishes expected behavior on named fixtures.
6. Individual phase files define execution order and local acceptance gates.
7. `progress.md` records execution state; it does **not** override a requirement.

If requirements conflict, stop and record the conflict. Do not pick the easier interpretation silently.

## Requirement traceability

Each product requirement has a stable ID, such as `REQ-LEARN-01`. Phase files identify relevant requirements and test IDs. Tests must assert behavior, not just implementation structure. Preserve requirement IDs across edits; mark superseded requirements explicitly.

## Phase workflow

- Work on one active phase at a time.
- A phase begins with an `IN_PROGRESS` checkpoint.
- A phase is accepted only after its required files exist, tests pass, screenshots are inspected when relevant, and implementation plus progress commits are pushed.
- The agent advances automatically after acceptance.
- External credentials and human approvals are blockers, not reasons to fabricate results.
- After interruption, reconcile Git, actual tests, and `progress.md` before resuming.

## Gate implementation

Phase 00 creates `scripts/gates.ts` and the npm command `npm run gate -- XX`.

The gate runner must:
- accept exactly one phase ID from 00–10;
- reject unknown phases;
- verify required files and required environment when applicable;
- run applicable lint, typecheck, unit, integration, build, and E2E commands;
- exit nonzero on any required failure;
- print a JSON summary containing phase, checks, outcomes, and duration;
- avoid printing secrets;
- distinguish local mocked tests from live-provider checks.

CI must run credential-free checks. Live Claude and deployment smoke tests run in separately configured secure environments.

## Git and change management

- Repository: public `Parth-Dua/breakwater-submission`, managed through authenticated `gh` CLI (user-directed visibility change, 2026-10-24).
- Main branch: `main` unless existing repository policy differs.
- Commit meaningful increments, at minimum one implementation commit and one progress-checkpoint commit per accepted phase.
- Use conventional commit messages with phase identifiers.
- Push before advancing; verify the remote ref.
- Never commit `.env.local` or secret-bearing output.
- If a requirement changes, update affected spec, tests, and progress decision log together.

## Completion

Release is not a screenshot or a compiled app. Release requires a working human-observation-to-approved-procedure loop, autonomous execution on unseen evidence, safe handling of a different charter, valid double-entry journals, and a replayable deployed demonstration.

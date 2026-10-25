# Breakwater v2 — Specification Index

**Status:** Normative · **Version:** 2.0 · **Adopted:** 2026-10-24
**Supersedes:** `docs/` (v1, delay-claim analyst). v1 is frozen history; do not implement from it.

Breakwater v2 is an autonomous **demurrage desk** for Meridian Commodities. It runs the work of three finance seats (laytime analyst, claims/recovery clerk, accruals accountant). It asks three human roles (Voyage Ops, Controller, Trader) only when it must. It also learns from what those humans actually do.

## Directory structure

~~~text
docs_v2/
├── README.md          ← this file: index, precedence, workflow, glossary
├── PRD.md             ← product intent, requirements (REQ-*), success criteria
├── WORLD.md           ← the simulated company, both scripted cases, answer key
├── ARCHITECTURE.md    ← components, runtime, orchestration, trust boundaries
├── CONTRACTS.md       ← schema, types, function signatures, tools, invariants
├── LEARNING.md        ← trace diff, lessons, Jev classifier, memory gate
├── UI.md              ← theme, layouts, components, copy rules, role swap
├── TEST_MATRIX.md     ← fixtures, invariants, acceptance tests
├── DEMO.md            ← the five-minute judged demo, minute by minute
├── MIGRATION.md       ← what to keep, change, retire from the v1 codebase
└── phases/
    ├── V00-baseline-cleanup.md
    ├── V01-design-system.md
    ├── V02-world-schema.md
    ├── V03-documents-sources.md
    ├── V04-simulation-engine.md
    ├── V05-domain-engines-ledger.md
    ├── V06-agent-runtime.md
    ├── V07-desk.md
    ├── V08-voyage-room.md
    ├── V09-human-work.md
    ├── V10-learning-memory.md
    ├── V11-proof.md
    └── V12-release-demo.md
~~~

## Specification precedence

1. `PRD.md`: product intent, scope, outcomes.
2. `WORLD.md`: the facts of the simulated world and the **answer key**. Numbers here are authoritative.
3. `CONTRACTS.md`: schema, types, signatures, invariants, permissions.
4. `LEARNING.md`: learning pipeline and memory governance.
5. `ARCHITECTURE.md`: component responsibilities and orchestration.
6. `UI.md`: visual and interaction acceptance.
7. `TEST_MATRIX.md`: expected behavior on named fixtures.
8. Phase files: execution order and local gates.
9. `progress.md`: execution state only. It never overrides a requirement.

If two documents conflict, **stop and record the conflict in `progress.md`**. Do not pick the easier reading. If the WORLD answer key disagrees with an engine result, the engine is wrong until proven otherwise. Fix the code, or record a reasoned correction to WORLD.md that the user approves.

## Spec-driven development rules

- **Stable IDs.** Requirements are `REQ-<AREA>-NN`. Fixtures are `W-NN` (world/answer key), `T-NN` (behavior), `U-NN` (UI). Never renumber. Mark superseded items `SUPERSEDED by …`.
- **Every requirement is testable.** Each REQ maps to at least one test ID in `TEST_MATRIX.md` and to a phase gate.
- **Contracts before code.** Types and function signatures in `CONTRACTS.md` are implemented exactly. A needed signature change goes into the spec first, in the same commit as the code.
- **Tests assert behavior on WORLD data, not implementation shape.**
- **Determinism.** Money, time, laytime, ledger, authorization, escalation routing, memory gating and backtests are pure deterministic code. Claude proposes; code decides.
- **Honesty labels.** Anything simulated is labeled in the Proof tab and in the data (`origin` fields). Classifier provider/calibration details remain internal under the user UI override of 25 Oct 2026.
- **One vertical slice at a time.** Finish a phase's gate before starting the next.

## Development and verification

Phase files describe implementation scope and intended acceptance checks. Their checklists are not evidence that this source snapshot has passed. `progress.md` records the current unvalidated state. Run app commands, automated checks and provider calls only when explicitly requested.

When validation is requested, `npm run gate -- VXX` checks required source, lint, typecheck, tests, build and relevant browser/live checks. Live evidence is reported separately from mocked checks. A saved report is valid only against the source it actually measured; no test mock establishes Jev accuracy. Never print secrets.

## Git and local setup

Repository: public `Parth-Dua/breakwater-submission`, branch `main`, independent history and deployment configuration. The source is published as one initial commit. No `.env.local`, dependency installation, credentials, prepared database or local backend state is supplied. `workflow.md` describes prerequisites and the intended local presentation flow. GitHub checks are manually triggered.

Classifier: Jev through `@langchain/typesafe`, with a Convex-only key for its selected transport. Missing credentials hold lessons for review. Financial answer-key values remain normative; observed service probabilities are not constants.

## Glossary (domain)

| Term | Meaning |
|---|---|
| **Charter party (CP)** | Contract between Meridian (charterer) and the shipowner. Demurrage under it is **payable** by Meridian. |
| **Sale / purchase contract** | Contract between Meridian and the cargo buyer/seller. Demurrage under it may be **recoverable** from that counterparty. |
| **Laytime** | Time allowed for loading/discharge without paying for waiting. |
| **Demurrage** | Money owed for time used beyond laytime, at a daily rate pro rata. |
| **NOR (Notice of Readiness)** | Master's notice that the vessel has arrived and is ready. Laytime starts a fixed notice time after a *valid* NOR. |
| **SOF (Statement of Facts)** | Port agent's signed log of events (arrival, berthing, holds, completion), usually in **local** time. |
| **Laytime statement** | Line-by-line calculation of time counted, excluded or half-counted, and the resulting demurrage. |
| **"Once on demurrage, always on demurrage"** | After laytime expires, laytime exceptions (e.g., weather) generally no longer interrupt demurrage, unless the contract says otherwise. |
| **Time bar** | Contract deadline to present a claim with documents. A missed deadline means the claim is lost. |
| **Back-to-back mismatch** | The difference between demurrage payable under the CP and demurrage recoverable under the sale contract. It is Meridian's net cost. |
| **Geofence** | Polygon for an anchorage or berth area. Used to test NOR validity and to detect shifting. |
| **Materiality** | The threshold below which a variance is accepted without asking anyone (and logged). |

## Glossary (system)

| Term | Meaning |
|---|---|
| **Desk** | Home page: company state, cases, books, proof. |
| **Voyage Room** | Single-case page: one vessel, one disruption. |
| **World script** | Deterministic, time-ordered list of world events (AIS pings, emails, notices, period closes) for a scenario. |
| **Sim clock** | The company's simulated time. Event-driven: it jumps to the next world event when the agent is idle. |
| **Ask** | A typed request from the agent to a human role. |
| **Persona** | A named demo identity for a role (selected with the role toggle). |
| **Trace diff** | The difference between what the agent did and what a human did on the same case. It is the raw material for learning. |
| **Lesson** | A typed, proposed memory item derived from a trace diff. |
| **Memory item** | An approved or held lesson: FACT, PROCEDURE or PRECEDENT. |
| **Gateway** | The only code path that writes to the books (journals) or files outgoing claims. |

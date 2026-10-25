# Breakwater v2 — Product Requirements

**Version:** 2.0 · **Status:** Normative · **Date:** 2026-10-24
**Event:** CalHacks 2026, Hyphenate track ("The Hyphenated Enterprise: Autonomous Systems for Finance")
**Company (fictional):** Meridian Commodities, a grain trader that charters ships and buys and sells cargo.

## 1. One line (submission)

> **Breakwater runs Meridian's demurrage desk: it calculates laytime, books accruals, disputes shipowners and recovers from cargo counterparties. It asks Voyage Ops for facts, the Controller for sign-off and the Trader for commercial calls, and it learns from what they do.**

Seats filled by the agent: **laytime analyst**, **claims & recovery clerk**, **accruals accountant**.
Human seats it works with: **Voyage Ops**, **Controller**, **Trader**.

## 2. The problem

One port delay creates money in two directions:
- Meridian **owes** demurrage to the shipowner under the charter party (AP).
- Meridian **may recover** demurrage from the cargo buyer or seller under the sale/purchase contract (AR).

The two contracts have different laytime, rates, exceptions, notice times and time bars. The sources disagree:
- the owner's NOR claims readiness before the ship arrived;
- the SOF is in local time across a daylight-saving change;
- AIS shows the ship moving during billed "waiting";
- the owner's invoice arrives after the buyer's time bar has expired.

Today this lives in spreadsheets and people's heads.

## 3. Mapping to the Hyphenate brief

| Brief | Breakwater evidence |
|---|---|
| Sources that disagree | NOR vs AIS geofence; SOF local time vs UTC invoice; owner statement vs computed statement; CP vs sale contract |
| Time | Sim clock across Oct→Dec 2026; October accrual, November true-up, December invoice; buyer time bar before owner invoice; period locks |
| Working with others | Three human roles; a busy approver (an ask aged 19 days, with a reminder); the Controller says no to one line; the Trader overrides commercially |
| Limits | Per-run capabilities; delegation limits as data; agent never approves; the gateway is the only writer; persona-based separation of duties |
| Explainable & accountable | Every number has a "why?" answer citing documents, AIS and clauses; append-only hash-chained audit |
| Is it real enough? | Real demurrage mechanics, real-looking PDFs read by Claude, 30+ historical cases, answer-key scoreboard |
| Would you hire it? | Three seats, limits in code, asks precisely three times, handles a "no" and an override |
| Something new | Finance reconciled against physical telemetry; two-sided demurrage; learning from human action traces, with explicit refusal to over-generalize |
| The moment | "The owner says the ship was ready at 06:00. The ship was 24 nautical miles outside port limits." Shown on the map. |

## 4. Users and roles

| Actor | Kind | Can | Cannot |
|---|---|---|---|
| **Agent** | System | Read authorized sources through capabilities; compute statements; post accruals and AP within delegation; file recovery claims within delegation; create asks; propose lessons | Approve anything; change policy, delegation or memory status; read sources outside its capabilities; move cash |
| **Voyage Ops** (persona *Dana Ruiz*) | Human | Investigate facts (mailbox, customs portal, document store); link evidence; answer fact asks; confirm teach-back on their own lessons | Approve payments, memory or policy |
| **Controller** (persona *Marcus Hale*) | Human | Approve or reject payments; edit statement lines (with basis); approve or reject memory items; close periods | Answer commercial asks; edit posted journals |
| **Trader** (persona *Priya Shah*) | Human | Decide pursue / partial / waive on recoveries | Approve payments or memory |
| **Observer** | Viewer | Watch everything | Any mutation |

Identities are **demo personas** selected with a role toggle (no passwords). The server resolves the acting persona from a server-side session record. It never trusts a client-sent role.

## 5. Requirements

### Simulation & world
- **REQ-SIM-01** A global sim clock persists in Convex. It is event-driven: it advances to the next scheduled world event when no agent task is running, and holds while an ask that gates the case is open (unless "Let time pass" is pressed).
- **REQ-SIM-02** `⚡ New disruption` starts the single scripted disruption (WORLD §4). It is idempotent; it is disabled while that disruption is active.
- **REQ-SIM-03** `demo:prepare` builds the demo baseline: history, Kestrel run genuinely to its pending Ops ask, sim clock at 2026-10-24 00:00 UTC. A reset restores exactly that baseline (except the audit chain, which records the reset).
- **REQ-SIM-04** Every world record carries `origin: "WORLD_SCRIPT" | "HISTORY_IMPORT" | "AGENT" | "HUMAN" | "SYSTEM"`.

### Sources (systems of record)
- **REQ-SRC-01** Nine simulated systems of record exist (WORLD §2). Each is accessible to the agent only through a typed tool gated by a capability.
- **REQ-SRC-02** Documents are real PDFs in Convex storage with varied layouts. Claude reads them via PDF input. Every extracted value carries a verbatim `quote` that must be found in the document text, or the extraction is rejected.
- **REQ-SRC-03** Document and email text is untrusted data. Instruction-like content never changes permissions or behavior.

### Agent work
- **REQ-AGT-01** The agent picks up work on its own: world events create agent tasks with no human trigger.
- **REQ-AGT-02** For every task the agent writes visible steps (title ≤ 60 chars; observation / check / conclusion; evidence refs; memory refs; money delta). No raw chain-of-thought is stored or shown.
- **REQ-AGT-03** Laytime statements (payable and recoverable) are computed by the deterministic engine from extracted facts, contract terms and active memory overrides. Claude never produces a monetary figure that is used.
- **REQ-AGT-04** Postcondition verifier: after each task, deterministic checks confirm the required outputs for that event type (CONTRACTS §9). Missing outputs get one repair turn, then `NEEDS_REVIEW`.
- **REQ-AGT-05** Escalations are routed by the stored escalation policy (CONTRACTS §8) to exactly one role. The agent cannot proceed past a gated action until the ask is answered (or the deadline fallback applies).
- **REQ-AGT-06** Variances below materiality are accepted without asking and logged with a reason.
- **REQ-AGT-07** Deadline fallback: if a recovery ask is unanswered and the time bar is under 5 days away, the agent files a protective notice (no waiver, full computed amount) within its delegation.

### Finance
- **REQ-FIN-01** Integer cents; integer minutes; UTC milliseconds. Local times exist only as document quotes.
- **REQ-FIN-02** Double-entry journals through the gateway only. Each journal balances, sits in an open period, has an idempotency key and links to evidence and authority.
- **REQ-FIN-03** Accrue the payable estimate at month-end. True up the next month. Reverse on invoice acceptance. Never backdate into a locked period.
- **REQ-FIN-04** Recognize a recoverable only when the claim is filed (prudence policy stored as data).
- **REQ-FIN-05** Disputed amounts with documentary support are not booked as liabilities. They are tracked on the case.
- **REQ-FIN-06** No cash movement and no payment endpoint.

### Human work & observation
- **REQ-HUM-01** All human work happens on the Voyage Room page through role work surfaces (UI §8). There are no role-specific pages.
- **REQ-HUM-02** Human actions are recorded as typed semantic events with persona, role, sim time, wall time and source IDs. No keystrokes, mouse trails or screenshots.
- **REQ-HUM-03** Answering an ask resumes the agent automatically.

### Learning & memory
- **REQ-LRN-01** At each human answer, compute a deterministic trace diff (agent trace vs the human's provenance chain).
- **REQ-LRN-02** Diffs become lesson JSON. An internal classifier returns kind, scope and discretionary probabilities.
- **REQ-LRN-03** A deterministic memory gate decides: ACTIVE, PENDING_CONTROLLER, PRECEDENT (non-executable), or NEEDS_REVIEW.
- **REQ-LRN-04** Procedures are backtested on historical cases before approval. The result is persisted.
- **REQ-LRN-05** Memory affects behavior only through typed payloads (contract-rule overrides, counterparty facts, procedure DSL with capability grants). There is no free-text instruction memory.
- **REQ-LRN-06** When the agent uses a memory item, the step shows "Used memory: …" and the item's usage list grows.
- **REQ-LRN-07** Commercial, discretionary decisions are never generalized.

### Explainability & audit
- **REQ-AUD-01** Every material transition writes an audit event in the same mutation. Events are hash-chained per namespace. `audit.verifyChain` passes.
- **REQ-AUD-02** "Why?" on any money figure or statement line returns 2–3 sentences whose citations are restricted to the deterministic provenance graph.

### UI
- **REQ-UI-01** Two pages: Desk (`/`) and Voyage Room (`/case/[caseCode]`). All other v1 routes redirect to `/`.
- **REQ-UI-02** Finance-grade visual system (UI §1–3). The primary demo viewport is 1440×900 with no page scroll.
- **REQ-UI-03** Copy budget: no explanatory paragraphs, no subtitles, one `SIM` badge, each financial metric appears once per view (equal amounts across distinct metrics or ledger records are allowed; user clarification 2026-10-24). Enforced by the copy linter and E2E tests.
- **REQ-UI-04** Role toggle (Observer / Ops / Controller / Trader). Only center stage and action affordances change; the header, timeline, money strip and rail stay.
- **REQ-UI-05** Live: Convex subscriptions update the Desk rows, thinking feed, memory and money without a reload.

### Proof
- **REQ-PRF-01** Proof tab: answer-key scoreboard over held-out generated voyages, real vs simulated table and audit-chain verification. Classifier calibration remains internal (25 Oct 2026 user override).
- **REQ-PRF-02** The scoreboard shows the actual run date, model, counts and metrics. Nothing is hardcoded.

## 6. Scope

**P0 (must ship):** everything above, for the two scripted cases (Kestrel, Aster Vale) plus history and the scoreboard set.
**P1 (only after V12 is accepted):** "what did we know at time T" bitemporal view; additional disruption scripts; mobile polish beyond read-only.
**Out of scope:** real AIS/ERP/bank/customs integrations; real payments; negotiation with counterparties beyond generated letters; fine-tuning; general screen observation.

## 7. Success criteria (acceptance targets, not measured claims)

- Aster Vale final numbers equal the WORLD §5 answer key exactly.
- The agent asks exactly the asks listed in WORLD §5.6, each routed to the listed role.
- The Kestrel lesson activates only after Controller approval and is used on Aster Vale (no Ops ask there).
- The Controller correction becomes an ACTIVE fact. The Trader waiver becomes a PRECEDENT and is never executed.
- All journals balance; zero unauthorized or duplicate postings; the audit chain verifies.
- The local demo guide (workflow.md) explains startup, repeatable baseline reset and the full intended live flow. V11 local verification remains required; the presenter tests/rehearses the complete demo (25 Oct 2026 override).

Jev classifies lesson JSON into kind, scope and discretionary probabilities. Keep provider/model names, confidence bars and calibration results internal; the UI shows the semantic lesson and its governed approval state.

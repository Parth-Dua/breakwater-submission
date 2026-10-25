# Breakwater — Product Requirements Document

**Version:** 2.0 | **Status:** Normative | **Date:** 2026-10-24
**Project:** CalHacks — Hyphenate's Autonomous Systems for Finance challenge
**Organization:** Meridian Commodities (fictional)

## 1. Product summary

Breakwater is an autonomous voyage-claims finance analyst. It compares carrier invoices, charter terms, AIS vessel movement, port notices, signed Operations logs, and accounting records. It identifies supported and unsupported charges, asks humans for missing facts, and posts permitted accounting entries through a deterministic authorization gateway.

Its differentiator is **learning from observed human work**. When an Operations Reviewer resolves an escalation using normal application actions, Breakwater captures semantic events, reconstructs the workflow, proposes a scoped reusable procedure, tests counterexamples, and requests Controller approval. Later, it applies the approved procedure to a genuinely unseen voyage.

Breakwater learns investigation processes, **not universal financial conclusions** from individual cases.

## 2. Why it matters for Hyphenate

| Judge concern | Demonstration evidence |
|---|---|
| Is it real enough? | Conflicting maritime records, signed logs, effective charters, prior accrual, source-linked financial decisions |
| Would you hire it? | Bounded autonomy, precise escalation, real roles, balanced journals, idempotency, revocation, audit |
| Did we see something new? | Semantic observation, episode reconstruction, typed reusable procedure, approval and replay |
| The moment | $30,000 claim versus $10,000 supported; observed human resolution; new procedure avoids repeat escalation |

The demo must use actual Convex records and workflow transitions. No scripted success states.

## 3. Users and roles

### Autonomous Finance Agent
Can inspect authorized claim evidence, run approved procedures, calculate proposals, create escalations, and post narrowly delegated routine journals through a protected gateway. Cannot approve procedures, change policy, edit posted journals, fabricate evidence, or execute payments.

### Voyage Operations Reviewer
Can investigate assigned operational questions, search the Operations archive, inspect vessel timeline, link signed evidence, and submit structured findings. Cannot approve finance policy, procedures, or journals.

### Finance Controller
Can approve/reject/narrow procedure candidates, review exceptions and financial proposals, revoke procedures, and inspect ledger and audit. Cannot silently alter immutable source evidence or posted journal lines.

### Auditor / Demo Admin
Auditor has read-only access. Demo Admin may reset/inject synthetic scenarios through a separately protected route. Neither can bypass financial approval.

## 4. Core requirements

### Claims and investigation
- **REQ-CLAIM-01:** Persist invoice, voyage, charter, source evidence, claimed minutes, and reconciliation.
- **REQ-CLAIM-02:** Partition claimed amount into supported, unverified, and disputed; preserve uncertainty.
- **REQ-CLAIM-03:** Distinguish vessel location evidence from operational cause and contractual eligibility.
- **REQ-CLAIM-04:** Provide source-linked findings, typed agent tool traces, and durable workflow state.
- **REQ-CLAIM-05:** Create a precise Operations escalation for missing cause; do not invent it.

### Human observation
- **REQ-OBS-01:** Record actual application events with actor, role, session, timestamp, and source IDs.
- **REQ-OBS-02:** Capture archive search, document opening, interval selection, evidence linking, correction, and submitted finding.
- **REQ-OBS-03:** Do not equate passive viewing with explicit human reasoning.
- **REQ-OBS-04:** Resume paused agent work after a valid human finding.

### Learning and governance
- **REQ-LEARN-01:** Convert completed human sessions into evidence-linked episodic summaries.
- **REQ-LEARN-02:** Distinguish observed actions, explicit findings, and AI-inferred rationale.
- **REQ-LEARN-03:** Generate only schema-valid, whitelisted procedural steps.
- **REQ-LEARN-04:** Test positive cases, missing evidence, alternate charter, and overgeneralization.
- **REQ-LEARN-05:** Require authenticated Controller approval before activation.
- **REQ-LEARN-06:** Retrieve and execute approved procedures by scope, not by hardcoded procedure ID.
- **REQ-LEARN-07:** Store one-off commercial exceptions as case-specific precedents only.
- **REQ-LEARN-08:** Support procedure versioning, revocation, and source provenance.

### Financial controls
- **REQ-FIN-01:** All money in integer cents; deterministic charter calculations.
- **REQ-FIN-02:** Every posted journal balances and references evidence and authority.
- **REQ-FIN-03:** No duplicate posting, no posting to locked periods, no mutation of posted lines.
- **REQ-FIN-04:** Enforce standing delegated authority and Controller exception approval on the server.
- **REQ-FIN-05:** No actual cash movement in the MVP.

### User experience
- **REQ-UI-01:** Interactive, synchronized vessel trajectory and evidence timeline.
- **REQ-UI-02:** Financial exposure and contract treatment visible alongside map.
- **REQ-UI-03:** Role-specific work queue and structured Operations workbench.
- **REQ-UI-04:** Controller review shows provenance, scope, tests, and impact.
- **REQ-UI-05:** Memory explorer, ledger, audit, and demo controls expose actual backend state.
- **REQ-UI-06:** Accessible keyboard controls, reduced motion, loading/error/permission states.

### Reliability and delivery
- **REQ-SYS-01:** Convex is the authoritative backend; Claude calls run server-side.
- **REQ-SYS-02:** Retriable agent workflows survive interruption without duplicate effects.
- **REQ-SYS-03:** Reproducible synthetic dataset with at least 12 voyages and isolated reset.
- **REQ-SYS-04:** All phase gates and release fixtures pass; real Claude smoke test succeeds.
- **REQ-SYS-05:** GitHub repository and progress checkpoints support coding-agent handoff.

## 5. Canonical voyage — V-203

Fictional vessel MV Aster Vale, synthetic Rotterdam-region voyage, invoice INV-203, charter CH-ALPHA v1.

Carrier claims **72 hours × $10,000/day = $30,000**.

| UTC interval | Duration | Initial evidence | Initial treatment |
|---|---:|---|---|
| Jan 12 00:00–Jan 13 00:00 | 24 h | Official port closure notice | $10,000 supported |
| Jan 13 00:00–Jan 15 00:00 | 48 h | AIS indicates waiting, cause unverified | $20,000 unverified |

Initial reconciliation:
- Claimed: 3,000,000 cents.
- Supported: 1,000,000 cents.
- Unverified: 2,000,000 cents.
- Disputed: 0 cents.

A signed Operations log exists in the wider archive, but is not linked to the claim packet. The initial approved agent authority covers claim-packet evidence and standard charter checks, **not autonomous search of the wider signed-log archive**. That access is available to Operations and may later be delegated through an approved procedure.

The agent asks Operations: **"What caused the additional 48 hours after the port closure ended?"**

Operations searches the archive, opens the signed log, aligns it to the vessel timeline, links it to V-203, and submits a structured finding: the additional interval was customs clearance.

Under the effective **CH-ALPHA v1** clause, customs-clearance delay is excluded from the reimbursable claim. The result becomes:
- Supported: $10,000.
- Unverified: $0.
- Disputed: $20,000.

The agent prepares a dispute. A synthetic **revised carrier invoice** for $10,000 must arrive before AP posting.

## 6. Accounting example

Prior $15,000 accrual:
- Dr Voyage Expense $15,000.
- Cr Accrued Liability $15,000.

On accepted revised invoice, if period/authority checks pass:
- Dr Accrued Liability $15,000.
- Cr Voyage Expense $15,000.
- Dr Voyage Expense $10,000.
- Cr Accounts Payable $10,000.

Net recognized expense $10,000; accrued liability $0; AP $10,000. No cash payment.

If original period is locked, never backdate an entry; create a permitted current-period adjustment proposal or Controller escalation.

Standing synthetic delegation:
- Agent may post accepted voyage invoice/AP entries up to $12,000 if evidence, contract, and open-period checks pass.
- Agent may clear matched accruals up to $20,000 under approved conditions.
- Higher, ambiguous, exceptional, or disputed actions require Controller review.
- These limits are stored governance data, not model instructions.

## 7. Learning demonstration

Historical approved procedures:
- P-001: compare invoice, AIS, and official port notice.
- P-002: calculate eligible delay using effective charter and verified evidence.

After Operations resolves V-203:
1. Record real work-session events.
2. Claude reconstructs an episode.
3. Candidate procedure is created through the normal ID allocator; demo candidate is expected to receive **P-009**.
4. Candidate searches signed Operations logs, verifies voyage/signature/interval, establishes cause, reads the applicable charter, and recalculates.
5. Tests cover CH-ALPHA, CH-BETA, missing/unsigned/wrong-voyage evidence, and scope mismatch.
6. Controller reviews and activates version 1.
7. Unseen V-204 uses the approved procedure without an Operations escalation.
8. V-205 has CH-BETA, under which customs time has different treatment; the procedure may investigate but must **not** copy CH-ALPHA's exclusion.
9. V-206 contains a one-time $5,000 goodwill exception; store it as non-executable precedent.

P-009 is a reusable investigation workflow, **not** a rule that customs time is always non-payable.

## 8. Primary screens

- `/overview` — unresolved exposure, claims, work, activity.
- `/claims` — searchable reconciliation.
- `/claims/[id]` — vessel time machine, evidence, contract, finance, trace.
- `/work` and `/work/[id]` — role-specific queue and investigation.
- `/memory` and `/memory/[id]` — episodes, candidates, procedures, tests, provenance.
- `/ledger` — journals, accruals, AP, periods.
- `/audit` — immutable business-event history.
- `/scenarios` — demo-admin-only reset and injections.

## 9. Scope boundaries

P0: end-to-end synthetic finance investigation, human observation, approved procedural learning, controlled posting, audit, and live demo.

Jev provides lesson classification. Later scope includes richer search, expanded analytics and export packets.

Out of scope: live AIS/ERP/bank integrations, real payments, autonomous negotiation, external computer-use observation, model fine-tuning, contract rewriting.

## 10. Success criteria

- 100% balanced posted journals; zero unauthorized or duplicate postings.
- Zero unapproved procedure executions.
- Real observed session produces a candidate after—not before—human work.
- Controller approval activates a tested procedure.
- V-204 resolves without repeat Operations escalation.
- V-205 uses its own charter treatment.
- V-206 does not become reusable authority.
- Complete source-linked audit and successful reset/replay.
- Deployed five-minute demonstration with live Claude integration.

All percentages and counts above are **acceptance targets**, not fabricated measured results.

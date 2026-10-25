# Breakwater — Judge Demo Runbook

**Target:** Five minutes | **Mode:** Real synthetic data, live application state

## Preconditions

- Correct deployed frontend and Convex environment.
- Anthropic key configured server-side.
- Operations and Controller demo identities authenticated.
- Demo scenario reset to baseline.
- P-001/P-002 approved; P-009 not active.
- V-203 signed log present in archive but not linked to claim.
- V-204 and V-205 held out from the learning run.
- No hardcoded successful outcomes or prerecorded workflow transitions.

## Timeline

### 0:00–0:45 — The discrepancy
Open V-203. Show $30,000 invoice versus $10,000 supported and $20,000 unverified. Scrub vessel time machine; AIS shows waiting, but not cause.

Narration: "The vessel stopped moving. That doesn't prove the carrier is entitled to charge us."

### 0:45–1:25 — Agent knows when to stop
Show actual agent tool trace and Operations escalation asking about the unexplained 48 hours. Point out source references and restricted archive authority.

### 1:25–2:15 — Human resolves work normally
As Operations Reviewer, search signed-log archive, inspect the log, align time range, link evidence, and submit customs cause. No essay or training prompt.

Show real semantic events captured during this session.

### 2:15–3:10 — Learning with controls
Show Claude reconstruction and new procedure candidate. Distinguish observed steps from inferred rationale. Display positive/negative test report and charter scope. As Controller, approve candidate.

Narration: "Breakwater learns the investigation, not a blanket rule about customs."

### 3:10–4:05 — Before/after autonomy
Inject V-204. Show approved procedure retrieved and signed archive searched autonomously. No repeat Operations task. Show actual execution record.

### 4:05–4:35 — Near miss
Inject V-205 with CH-BETA. Show the agent reading CH-BETA and **not** copying CH-ALPHA's financial conclusion. Optionally show a revoked or missing-log safety test.

### 4:35–5:00 — Finance and audit
Introduce accepted revised $10k invoice. Show $15k accrual reversal and $10k AP journal, balanced and source-linked. Show audit trail and one-off goodwill exception remaining non-executable.

Closing line: "Breakwater learns from every human intervention — but it doesn't assume every human decision should become a rule."

## Judge interaction

Offer one real variation:
- different charter;
- missing signed log;
- revoked procedure;
- locked period.

Do not let judge controls write final answers directly. They inject source conditions and trigger the same workflow.

## Reset and recovery

- Reset only isolated demo data.
- Confirm P-009 absent again.
- Confirm V-203 baseline amounts.
- Confirm ledger baseline and role identities.
- If Claude fails, show persisted workflow state; do not fake completion.
- If internet/map tiles fail, use local geometry fallback with real timeline data.

## Rehearsal evidence

Record:
- deployment URL;
- reset success;
- real Claude smoke result;
- actual demo duration;
- screenshot paths;
- tested variation;
- issues found and resolved.

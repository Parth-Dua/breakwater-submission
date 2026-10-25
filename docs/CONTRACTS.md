# Breakwater — Data, API, Procedure, and Financial Contracts

**Version:** 1.0 | **Status:** Normative

## 1. Units and IDs

- Money: integer USD cents. Example $30,000 = `3000000`.
- Durations: integer minutes. Example 72 hours = `4320`.
- Timestamps: Unix milliseconds UTC.
- Coordinates: WGS84; GeoJSON longitude, latitude order.
- Business IDs: stable strings `V-203`, `INV-203`, `P-009`.
- Convex IDs: internal references, never substituted for business IDs in user-facing views.
- Rate: integer cents per 1,440 minutes.
- Round once per charge line using a documented integer half-up function.

## 2. Required Convex tables

| Table | Required fields | Indexes |
|---|---|---|
| users | identity, role, active, displayName | by_identity |
| vessels | vesselCode, name, synthetic | by_code |
| voyages | voyageCode, vesselId, charterId, startAt, endAt, scenarioId | by_code, by_scenario |
| aisPoints | voyageId, at, lat, lon, speedKnots, heading, quality | by_voyage_at |
| portEvents | voyageId, startAt, endAt, type, evidenceId | by_voyage_start |
| charters | charterCode, version, effectiveAt, clauseFamily, terms | by_code_version |
| invoices | invoiceCode, voyageId, claimedMinutes, amountCents, status, replacesInvoiceId | by_code, by_voyage |
| claims | claimCode, voyageId, invoiceId, status, supportedCents, unverifiedCents, disputedCents, revision | by_code, by_status |
| evidence | evidenceCode, voyageId, type, signedStatus, startAt, endAt, content, visibility | by_code, by_voyage_type |
| workItems | claimId, type, assignedRole, status, question, evidenceIds, correlationId | by_role_status, by_claim |
| workSessions | workItemId, actorId, startedAt, endedAt, status | by_work_item |
| actionEvents | sessionId, actorId, eventType, at, payload | by_session_at |
| caseEpisodes | claimId, sessionId, observedSteps, explicitFindings, inferenceNotes, summary | by_claim |
| procedureCandidates | candidateCode, sourceEpisodeId, scope, steps, testReport, status, revision | by_status |
| approvedProcedures | procedureCode, version, scope, steps, approvedBy, status | by_code_version, by_status |
| procedureExecutions | procedureId, claimId, runId, result, toolOutcomes | by_claim |
| agentRuns | claimId, revision, state, step, correlationId, attempt, lastError | by_claim, by_state |
| accountingPeriods | periodCode, startAt, endAt, status | by_period |
| journalEntries | entryCode, claimId, periodId, idempotencyKey, sourceIds, status | by_idempotency, by_claim |
| journalLines | entryId, accountCode, side, amountCents | by_entry |
| delegations | actionType, maxAmountCents, conditions, effectiveAt, status | by_action_status |
| auditEvents | actor, eventType, entityType, entityId, correlationId, at, details | by_entity_at, by_correlation |
| scenarioRuns | scenarioCode, seedVersion, status, createdBy | by_code |

Auth implementation may require additional provider tables. Use Convex validators for all public and internal boundaries.

## 3. Claim arithmetic

For the canonical one-line claim:

`claimedCents = supportedCents + unverifiedCents + disputedCents`

All values are nonnegative integers.

V-203 before Operations:
- claimed 3,000,000;
- supported 1,000,000;
- unverified 2,000,000;
- disputed 0.

V-203 after signed finding and charter evaluation:
- claimed 3,000,000;
- supported 1,000,000;
- unverified 0;
- disputed 2,000,000.

Never classify unverified time as definitively disputed before evidence and charter evaluation.

## 4. Evidence semantics

- AIS supports movement and position, not cause.
- Port notice supports the stated closure interval.
- Signed Operations log supports an operational cause only if voyage, signature metadata, and interval match.
- Effective charter controls contractual eligibility.
- Ledger records control posted accounting facts.

Reject overlapping or negative segments, wrong-voyage evidence, invalid charter versions, and unexplained causal leaps. Conflicting sources create a review requirement, not arbitrary precedence.

## 5. Charter calculation contract

~~~typescript
type DelayCause = "PORT_CLOSURE" | "CUSTOMS" | "BERTH" | "WEATHER" | "UNKNOWN";

type DelaySegment = {
  startAt: number;
  endAt: number;
  cause: DelayCause;
  evidenceIds: string[];
};

type CharterTerms = {
  clauseFamily: string;
  rateCentsPerDay: number;
  payableCauses: DelayCause[];
  excludedCauses: DelayCause[];
  effectiveFrom: number;
  effectiveTo: number;
};
~~~

Only verified, nonoverlapping intervals may enter payable-minute calculation. Unknown cause remains unverified. Calculate using the actual charter, never a remembered outcome. Test 90 eligible minutes at $10,000/day = 62,500 cents.

## 6. Claim state machine

~~~text
RECEIVED -> INVESTIGATING
INVESTIGATING -> WAITING_OPERATIONS | WAITING_CONTROLLER
INVESTIGATING -> DISPUTE_PREPARED | ACCEPTED | ON_HOLD
WAITING_OPERATIONS -> INVESTIGATING | ON_HOLD
WAITING_CONTROLLER -> INVESTIGATING | ON_HOLD
DISPUTE_PREPARED -> AWAITING_VENDOR_REVISION
AWAITING_VENDOR_REVISION -> ACCEPTED (only on valid revised invoice)
ACCEPTED -> POSTING_PENDING -> POSTED | WAITING_CONTROLLER
POSTED -> REOPENED -> INVESTIGATING (late contradictory evidence)
ON_HOLD -> INVESTIGATING (new evidence)
~~~

Work-item states: `OPEN`, `CLAIMED`, `WAITING_INFORMATION`, `SUBMITTED`, `APPROVED`, `REJECTED`, `CANCELLED`.

Work-item types: `OPS_FACT`, `CONTROLLER_PROCEDURE`, `CONTROLLER_FINANCIAL`, `CONTROLLER_EXCEPTION`.

## 7. Semantic observation events

~~~typescript
type ObservationEvent = {
  sessionId: string;
  workItemId: string;
  claimId: string;
  actorId: string;
  actorRole: "operations_reviewer" | "finance_controller";
  eventType:
    | "WORK_SESSION_STARTED"
    | "ARCHIVE_SEARCHED"
    | "EVIDENCE_OPENED"
    | "TIMELINE_RANGE_SELECTED"
    | "EVIDENCE_COMPARED"
    | "EVIDENCE_LINKED"
    | "FINDING_EDITED"
    | "FINDING_SUBMITTED"
    | "DECISION_CORRECTED"
    | "EXCEPTION_AUTHORIZED"
    | "WORK_SESSION_COMPLETED";
  at: number;
  payload: Record<string, unknown>;
  correlationId: string;
};
~~~

Actor ID and role are resolved server-side. Material mutations and audit events are atomic. Throttle view events. Never capture raw keystrokes, passwords, mouse trails, or screenshots. A view is not proof of reasoning.

## 8. Learning output contract

Reconstruction stores:
- problem summary;
- chronological observed steps;
- explicit submitted findings;
- linked evidence IDs;
- inferred rationale labeled as inference;
- candidate reusable steps;
- potential one-time exception;
- ambiguity and unresolved questions.

Classification labels may overlap: `FACTUAL_CORRECTION`, `INVESTIGATION_PROCEDURE`, `COMMERCIAL_EXCEPTION`, `GOVERNANCE_CHANGE`.

An episode is descriptive and **not executable**.

## 9. Whitelisted procedure DSL

Allowed operators:
- `FIND_EVIDENCE`
- `VERIFY_EVIDENCE`
- `MATCH_INTERVAL`
- `READ_CHARTER`
- `CLASSIFY_CAUSE`
- `CALCULATE_ELIGIBLE_MINUTES`
- `ESCALATE_IF_MISSING`
- `RECORD_FINDING`

Example procedure:

~~~json
{
  "dslVersion": 1,
  "scope": {
    "claimType": "DELAY",
    "clauseFamilies": ["PORT_DELAY_ALPHA", "PORT_DELAY_BETA"],
    "requiresUnexplainedInterval": true,
    "archiveAccess": "SIGNED_OPS_LOG"
  },
  "steps": [
    {"op":"FIND_EVIDENCE","type":"SIGNED_OPS_LOG","repository":"OPS_ARCHIVE"},
    {"op":"VERIFY_EVIDENCE","checks":["SAME_VOYAGE","SIGNED","INTERVAL_COVERAGE"]},
    {"op":"MATCH_INTERVAL","target":"UNEXPLAINED_INTERVAL"},
    {"op":"READ_CHARTER","field":"CAUSE_TREATMENT"},
    {"op":"CLASSIFY_CAUSE","source":"SIGNED_OPS_LOG"},
    {"op":"CALCULATE_ELIGIBLE_MINUTES"},
    {"op":"ESCALATE_IF_MISSING","role":"OPERATIONS_REVIEWER"}
  ]
}
~~~

Maximum eight steps. No loops, arbitrary JavaScript, network calls, self-approval, or governance modification. `READ_CHARTER` must evaluate the current voyage's effective terms. P-009 may investigate CH-BETA, but may not copy CH-ALPHA's exclusion.

Scope mismatch returns `NOT_APPLICABLE`. Missing evidence returns `NEEDS_REVIEW` or an authorized escalation.

## 10. Procedure lifecycle

Candidate states: `DRAFT`, `TESTING`, `READY_FOR_REVIEW`, `APPROVED`, `REJECTED`, `SUPERSEDED`.

Activation requires:
1. Source episode exists.
2. Observed/inferred steps are separated.
3. Explicit scope and DSL validate.
4. At least two positive and three negative fixtures pass.
5. Missing-evidence, wrong-voyage, unsigned, and alternate-charter cases are tested.
6. Persisted test report matches candidate revision.
7. Authenticated Controller approves atomically.

Narrowing creates a new revision and retests. Revocation blocks new executions immediately. Historical records remain.

Seed P-001/P-002 as approved, P-003–P-008 as archived historical IDs; next generic allocated candidate can be P-009. **Never branch behavior on P-009 or voyage IDs.**

## 11. Procedure retrieval and authority

Filter active procedures by claim type, approved charter families, required evidence, and unexplained interval. Rank deterministically by scope specificity. Conflicting matches cause safe review.

Initial finance agent may inspect claim packet, AIS, official port notice, and charter. Wider signed Operations archive requires either a human Operations session or approved scoped procedure. Controller approval grants only that investigation capability, not financial authority.

## 12. Financial posting gateway

Only protected internal Convex mutation may post. Validate:
1. Valid workflow and authorized internal caller.
2. Existing accepted invoice, not merely disputed claim.
3. Verified evidence and effective charter.
4. Delegation or explicit Controller authorization.
5. Open period.
6. Valid accounts and positive integer line amounts.
7. Balanced debits and credits.
8. Stable idempotency key not previously posted.
9. Atomic journal and audit event.
10. Immutable posted lines.

Correct accrual sequence:
- Original: Dr Expense 1,500,000 / Cr Accrued Liability 1,500,000.
- Reversal: Dr Accrued Liability 1,500,000 / Cr Expense 1,500,000.
- Accepted invoice: Dr Expense 1,000,000 / Cr AP 1,000,000.

No cash movement. Locked-period corrections require current-period adjustment or escalation.

## 13. API boundaries

Public queries: `claims.list`, `claims.getDetail`, `voyages.getTimeline`, `workItems.listForCurrentRole`, `workItems.get`, `memories.list`, `memories.get`, `finance.getClaimLedger`, `audit.listForEntity`.

Authorized public mutations: `workItems.claimTask`, `workItems.recordObservation`, `workItems.linkEvidence`, `workItems.submitFinding`, `memories.reviewCandidate`, `finance.reviewProposal`, `scenarios.resetDemo`, `scenarios.inject`.

Internal actions/mutations: `agent.investigate`, `workflow.transition`, `learning.reconstructEpisode`, `learning.proposeProcedure`, `procedures.evaluate`, `ledger.postAuthorized`.

Claude tool names: `get_claim_snapshot`, `get_voyage_timeline`, `get_port_events`, `get_charter_clause`, `list_claim_evidence`, `search_ops_archive`, `get_accrual_balance`, `get_approved_procedures`, `propose_operational_question`, `propose_financial_resolution`.

Every tool call validates schema and authority. Claude never receives arbitrary database mutation access.

## 14. Retry, security, and secrets

- One active run per claim revision.
- Stable operation keys for side effects.
- Bounded retries and durable failure state.
- Server-derived roles; no client role trust.
- Authenticated Operations and Controller.
- Demo admin route separately protected.
- Secrets only in Convex server environment.
- Frontend uses `NEXT_PUBLIC_CONVEX_URL`; local tooling uses `CONVEX_DEPLOYMENT`.
- `ANTHROPIC_API_KEY` must not reach browser bundles.
- Do not claim cryptographic audit immutability unless implemented.

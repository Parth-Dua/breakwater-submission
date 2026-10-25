# Breakwater v2 — Learning and Memory

**Version:** 2.0 · **Status:** Normative

Breakwater learns **what it was missing**: the difference between what it did and what a human did on the same case. It refuses to learn commercial judgment. Memory changes behavior only through typed payloads that deterministic code consumes.

~~~text
human answers an ask
  → provenance chain of the human's actions (noise removed)
  → TRACE DIFF vs the agent's tool trace on the same case
  → LESSON JSON (deterministic fields + Claude-drafted text and payload)
  → CLASSIFIER (Jev): kind · scope · discretionary
  → MEMORY GATE (pure code): ACTIVE / PENDING_CONTROLLER / PRECEDENT_ONLY / NEEDS_REVIEW
  → [TEACH-BACK to the source human] → [BACKTEST for procedures] → [Controller approval]
  → used by the engine/capabilities on later cases, shown as "Used memory"
~~~

## 1. Inputs

- **Agent trace** for the case: `agentSteps.toolCalls` across all tasks of the case, normalized to `TraceOp = { op: "SEARCH" | "READ" | "COMPUTE" | "ASK" | "POST", system?: SourceSystem, subject?: string }`.
- **Human events** for the ask: `humanEvents` ordered by `seq`.

## 2. Trace diff (`src/domain/diff.ts`)

~~~ts
computeTraceDiff(input: { agentOps: TraceOp[]; humanEvents: HumanEvent[]; ask: Ask;
  statementBefore?: StatementLine[]; statementAfter?: StatementLine[]; agentRecommendation?: string }): TraceDiff[]
~~~

### 2.1 Provenance chain (noise removal)
Only human events that **contributed to the answer** count:
- The answer's `evidence[]` → the `EVIDENCE_LINKED` events that linked them → the `DOCUMENT_OPENED` events for those documents → the `SOURCE_SEARCHED` events whose results contained them.
- `LINE_EDITED` events referenced by `answer.editIds`.
- Everything else (browsing, unlinked opens) is ignored and listed as `ignoredEventIds` for transparency.

### 2.2 Diff types
| Type | Condition | Human side | Agent side |
|---|---|---|---|
| `MISSING_SOURCE` | The provenance chain used a `system` that never appears in the agent trace for this case | `{ system, searchQuery, documentKind, linkedTo: lineId }` | `{ systemsTried: SourceSystem[], askedRole }` |
| `VALUE_CORRECTION` | A `LINE_EDITED` changed a treatment or value | `{ lineId, lineKind, from, to, basis }` | `{ value, ruleSource: "REGISTER" \| "MEMORY" \| "ENGINE" }` |
| `COMMERCIAL_DECISION` | Answer to `COMMERCIAL_DECISION` differs from `PURSUE` | `{ option, amountCents, reason }` | `{ recommendation: "PURSUE", amountCents }` |
| `CONFIRMATION` | Human confirmed exactly what the agent proposed | — | — (no lesson) |

## 3. Lesson JSON (the curated state sent to the classifier)

Deterministic fields are filled by code. `lesson_text` and `proposed_payload` are drafted by Claude (`lessons.build`, effort high) and then **validated**: the payload must be one of the types in §3.1 and consistent with the diff (e.g., a `VALUE_CORRECTION` on a closure line can only produce a `CONTRACT_RULE_OVERRIDE` on that case's contract form and that clause).

~~~json
{
  "lesson_text": "Nordhavn CP-2019: closures count in full once on demurrage",
  "diff_type": "VALUE_CORRECTION",
  "source": { "role": "controller", "action": "LINE_EDITED", "case": "DC-2026-0412" },
  "agent_did": "Counted port closure at half (register cl. 8)",
  "human_did": "Counted port closure in full",
  "human_basis": { "clause": "8", "note": "CP cl. 8 proviso: already on demurrage" },
  "references": {
    "contract_clause": true, "contract_form": "NORDHAVN-CP-2019",
    "counterparty_specific": false, "amount_specific": false,
    "port_specific": false, "relationship_language": false
  },
  "financial_impact": true, "grants_access": false,
  "history": { "corroborating": 2, "contradicting": 0 },
  "proposed_payload": { "type": "CONTRACT_RULE_OVERRIDE", "formCode": "NORDHAVN-CP-2019",
    "clause": "8", "rule": "EXCEPTIONS_APPLY_ON_DEMURRAGE", "value": false }
}
~~~
`relationship_language` is computed deterministically: the reason matches `/(goodwill|relationship|favou?r|key (buyer|client)|one[- ]off|exception)/i`.
`history` is computed by `precedentSearch` over closed cases with the same diff signature.

### 3.1 Memory payload types (whitelist)
~~~ts
type MemoryPayload =
  | { type: "CONTRACT_RULE_OVERRIDE"; formCode: string; clause: string;
      rule: "EXCEPTIONS_APPLY_ON_DEMURRAGE" | "TREATMENT"; intervalKind?: IntervalKind; value: boolean | Treatment }
  | { type: "COUNTERPARTY_FACT"; counterpartyCode: string; key: "SOF_TIMEZONE" | "INVOICE_INCLUDES_SHIFTING"; value: string }
  | { type: "PROCEDURE"; procedure: Procedure }          // CONTRACTS §6
  | { type: "PRECEDENT"; summary: string; counterpartyCode?: string; amountCents?: number }  // never executable
~~~

## 4. Classifier

### 4.1 Provider interface (`convex/node/classifier/index.ts`)
~~~ts
interface ClassifierProvider {
  readonly id: "jev";
  readonly model: string;                                   // requested Jev model
  classify(lesson: LessonJson): Promise<ClassifierResult>;
}
type ClassifierResult = {
  kind:  { choice: "FACT" | "PROCEDURE" | "PRECEDENT" | "POLICY_CHANGE"; probabilities: Record<string, number>; confidence: number };
  scope: { choice: "THIS_CASE" | "COUNTERPARTY" | "PORT" | "CHARTER_FORM" | "ALL"; probabilities: Record<string, number>; confidence: number };
  discretionary: { noul: number };                          // probability "yes"
  provider: "jev"; model: string; requestId?: string;
};
function getClassifier(): ClassifierProvider  // Jev; credentials required in Convex
~~~
The provider, actual served model and response are persisted in `classifierCalls` for internal audit. Provider details and calibration are not displayed in the product UI.

### 4.2 Questions (Jev receives them verbatim)
~~~ts
const QUESTIONS = {
  kind: { type: "choice", instructions: "What kind of lesson is this for a demurrage desk?",
    criteria: {
      FACT: "A fact or contract interpretation that changes how a rule is applied",
      PROCEDURE: "A reusable investigation step: where to look or what to check",
      PRECEDENT: "A one-off decision tied to a specific situation or relationship",
      POLICY_CHANGE: "A change to authority, limits or approval rules" } },
  scope: { type: "choice", instructions: "How widely should this lesson apply?",
    criteria: {
      THIS_CASE: "Only this case", COUNTERPARTY: "All cases with this counterparty",
      PORT: "All cases at this port", CHARTER_FORM: "All voyages under this contract form",
      ALL: "All cases where the trigger occurs" } },
  discretionary: { type: "noul",
    instructions: "Is this a commercial judgment call rather than a rule that should be repeated?" },
} as const;
~~~

### 4.3 `JevClassifier`
- Package `@langchain/typesafe`, class `TypeSafeClassifier`, constructed once with `questions: QUESTIONS`, `apiKey: process.env.TYPESAFE_API_KEY`, `dangerouslyAllowBrowser: false`, `timeout: 10000`, `maxRetries: 2`. Use the model option to pin `jev-1.13.0` for direct TypeSafe, or `typesafe/jev-1.13` for OpenRouter. Persist the actual served model from `response.model`.
- `invoke(lessonJson)` → map `response.answers.kind.choice/probabilities/confidence`, `scope`, `discretionary.noul` into `ClassifierResult`.
- Send only the lesson JSON (synthetic, no secrets). Errors map to `CLASSIFIER_UNAVAILABLE` → gate `NEEDS_REVIEW`.
- Runs in a Node action. The key lives only in Convex env.

### 4.4 Calibration set
`fixtures/learning/calibration.json` contains 40 curated lesson JSONs with expected `{kind, scope, discretionary: boolean}`: 10 MISSING_SOURCE, 14 VALUE_CORRECTION, 12 COMMERCIAL_DECISION and 4 POLICY_CHANGE. Adversarial examples include commercial reasons phrased as rules and clause corrections mentioning a counterparty.

`npm run learning:calibrate` invokes Jev and writes actual per-item responses and a `calibrationRuns` row. Accuracy is computed from those responses, never inferred from fixture expectations or unit-test mocks. Calibration is internal evidence. No live calibration is claimed for this source snapshot.

## 5. Memory gate (`src/domain/memory-gate.ts`, pure)

~~~ts
decideMemory(input: { lesson: LessonJson; result: ClassifierResult | null; policies: PolicySet }): GateDecision
type GateDecision = { status: MemoryStatus; reason: string; requires: ("TEACH_BACK" | "BACKTEST" | "CONTROLLER")[] };
~~~
Rules, evaluated in order (the first match wins):
1. `result == null` → `NEEDS_REVIEW` · "Classifier unavailable".
2. `discretionary.noul ≥ 0.70` **or** `kind.choice = PRECEDENT` → `PRECEDENT_ONLY` · "Commercial judgment — kept as precedent, won't be reused".
3. `kind.choice = POLICY_CHANGE` → `REJECTED` · "Policy changes are governed outside memory".
4. `kind.confidence < 0.60` or `scope.confidence < 0.50` → `NEEDS_REVIEW` · "Low confidence — Controller decides".
5. payload `PROCEDURE` (grants access) → `PENDING_TEACHBACK` → then `BACKTEST` → `PENDING_CONTROLLER`.
6. `financial_impact = true` → `PENDING_TEACHBACK`. If the source persona is the Controller, the teach-back answer **is** the approval (agent proposed, Controller approved: separation holds). Otherwise → `PENDING_CONTROLLER`.
7. else → `PENDING_TEACHBACK` → `ACTIVE` on confirmation.

A teach-back answer of "Just this case" converts the item to `PRECEDENT_ONLY`. "Don't" → `REJECTED`.

## 6. Backtest (`src/domain/backtest.ts`, pure)

~~~ts
runBacktest(p: Procedure, history: HistoricalCase[]): { cases: BacktestCaseResult[]; consistent: number; total: number }
type BacktestCaseResult = { caseCode: string; procedureOutcome: ProcedureOutcome["result"];
  humanOutcome: "VERIFIED" | "ESCALATED" | "REJECTED"; consistent: boolean };
~~~
It replays the procedure (`interpretProcedure`) with tool runners backed by **historical** source data, over cases where `matchProcedure` is true. `consistent` means VERIFIED↔VERIFIED, or ESCALATE↔(ESCALATED|REJECTED). Approval UI requires `total ≥ 3`. A report with `consistent < total` is shown with the failing cases. The Controller may still approve, with a reason.

## 7. Lifecycle and use

- `ACTIVE` items are versioned. Revocation by the Controller is immediate: capabilities are recomputed per run and overrides are excluded from the next `computeStatement`.
- **Use tracking:** when `computeStatement` applies an override, or `resolveCapabilities` grants from a procedure, the item ID goes into `statements.memoryItemIds` / `agentSteps.memoryRefs`, and the case is appended to `memoryItems.usedIn`. The UI shows "Used memory · M-0007".
- `PRECEDENT_ONLY` items are visible to `search_memory` as context ("Hansa received a goodwill waiver in Dec 2026"). They can never be consumed by the engine or the capability resolver (enforced by payload type).
- Historical precedents (`HISTORY_IMPORT`) exist from day one; learned items carry `origin: HUMAN` lineage via `sourceAskId`.

## 8. What the demo must show (from WORLD)
| Moment | Expected |
|---|---|
| Kestrel, Ops answer | `MISSING_SOURCE` → PROCEDURE → teach-back (Ops: All ports) → backtest 6/6 → Controller approves → ACTIVE |
| Aster Vale, phyto hold | Capability granted by the procedure → `search_customs_portal` → VERIFIED → no Ops ask; step shows "Used memory" |
| Aster Vale, Controller edit | `VALUE_CORRECTION` → FACT → teach-back (Controller: all NORDHAVN-CP-2019) → ACTIVE (no separate approval) |
| Aster Vale, Trader partial | `COMMERCIAL_DECISION` + relationship language → PRECEDENT_ONLY, shown greyed with the reason |

### V10 defensive activation invariants
The gate keeps commercial diffs and PRECEDENT payloads non-executable even if a provider returns an inconsistent kind/discretionary label. Every activation path rechecks a persisted successful classifier result; malformed/unavailable drafts cannot be approved into active memory. Low-confidence procedures require scope confirmation and a backtest before Controller activation. This strengthens the no-commercial-learning and no-self-approval boundaries; provider probabilities never grant authority.

### Jev transports
`BREAKWATER_JEV_TRANSPORT` chooses the network transport for Jev. `typesafe` uses `TYPESAFE_API_KEY` and model `jev-1.13.0`. `openrouter` uses `OPENROUTER_API_KEY`, fixed SDK `baseUrl: https://openrouter.ai/api` and model `typesafe/jev-1.13`; the SDK appends `/v1/systemone`. Record the actual served model. Keys live only in Convex. Missing keys or service errors produce `CLASSIFIER_UNAVAILABLE` and hold the lesson for review.

### UI disclosure
Provider/model names, confidence bars and calibration results remain internal. Memory shows semantic changes, scope, approval and backtest information. Proof shows scoreboard measurements and audit verification. All classification records and activation checks remain required.

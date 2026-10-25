# Breakwater v2 — Architecture

**Version:** 2.0 · **Status:** Normative

## 1. Stack (keep what works; see MIGRATION.md)

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4 |
| Backend | Convex (queries, mutations, actions, scheduler, file storage, realtime subscriptions) |
| Identity | Convex Auth **Anonymous** provider + server-side `demoSessions` persona selection (no passwords) |
| LLM | Anthropic TypeScript SDK `@anthropic-ai/sdk`, server-side only, in Convex Node actions (`"use node"`) |
| Classifier | `JevClassifier` via `@langchain/typesafe`, exposing the `ClassifierProvider` interface |
| Maps | MapLibre GL JS with the OpenFreeMap "positron" style (no key; verify the URL in V08) and a bundled coastline GeoJSON fallback |
| PDFs | `pdf-lib` (generation, Node), `pdfjs-dist` (browser viewer + server text extraction) |
| Time zones | `luxon` (IANA conversions) inside pure domain code |
| Hashing | `@noble/hashes/sha256` (sync, deterministic, works in the Convex V8 runtime) |
| Tests | Vitest + `convex-test` (domain/integration), Playwright (E2E, system Chrome) |
| Hosting | Vercel (frontend, project `your-project`), Convex cloud deployment |

Do **not** add a vector DB, Redis, queues, LangGraph/agent frameworks, or a second database. Convex is the system of work; the simulated systems of record live in Convex tables tagged by `system`.

## 2. Components

~~~mermaid
flowchart LR
  subgraph Browser
    DESK[Desk /]
    ROOM[Voyage Room /case/:code]
  end
  subgraph Convex["Convex (system of work)"]
    SESS[Persona sessions]
    SIM[Sim clock + world scripts]
    ORCH[Orchestrator: events -> agent tasks]
    AGT[Agent runtime (Node action)]
    CAP[Capability resolver]
    TOOLS[Typed source tools]
    ENG[Deterministic engines: laytime, geo, time, ledger, policy]
    GW[Gateway: journals, filings, asks]
    OBS[Human action events]
    LRN[Learning: diff -> lesson -> classify -> gate]
    MEM[Memory items + procedures]
    AUD[Hash-chained audit]
    EXP[Explain: why?]
    SOR[(Systems of record tables)]
  end
  CLAUDE[(Claude API)]
  JEV[(TypeSafe Jev)]
  DESK & ROOM -->|subscriptions| Convex
  ROOM -->|human mutations| OBS
  SIM --> ORCH --> AGT
  AGT --> CLAUDE
  AGT --> CAP --> TOOLS --> SOR
  AGT --> ENG
  AGT --> GW --> SOR
  OBS --> LRN --> MEM
  LRN --> JEV
  LRN --> CLAUDE
  MEM --> CAP
  MEM --> ENG
  GW --> AUD
  EXP --> CLAUDE
~~~

## 3. Runtime split

| Runtime | Holds |
|---|---|
| Pure TS (`src/domain/**`) | All deterministic logic: money, intervals, time zones, geofence, laytime engine, reconciliation, ledger validation, escalation policy, capability resolution, trace diff, memory gate, procedure interpreter, backtest. **No I/O.** Imported by Convex functions and tests |
| Convex V8 (`convex/*.ts`) | Queries, mutations, scheduler, gateway, audit chain, sim clock, orchestrator |
| Convex Node (`convex/node/*.ts`, `"use node"`) | Claude calls, Jev calls, PDF text extraction, PDF generation |
| Browser | Rendering only. Never computes money; formats backend values |

## 4. Simulation engine

- `simClock` singleton per namespace: `{ simNow, status: RUNNING|HELD|IDLE, holdReason?, pacing: "1x"|"2x" }`.
- `worldScripts` and `worldEvents` (`scheduledAt`, `releasedAt?`). Release loop (`sim.tick`, scheduled internal mutation):
  1. If any agent task is `QUEUED|RUNNING` → do nothing (re-check in 500 ms).
  2. If the clock is `HELD` (open gating ask, no "let time pass") → do nothing.
  3. Otherwise take the next unreleased event; animate `simNow` toward it (UI interpolates over 1,200 ms at 1x); set `simNow = scheduledAt`; mark it released; write the source records (email row, AIS points, customs record…); enqueue agent tasks via the orchestrator; audit `WORLD_EVENT_RELEASED`.
- **Determinism:** world events never depend on agent output. The agent's *responses* are live; the world is scripted.
- `⚡ New disruption` → `sim.startDisruption()` attaches script `RTM-STORM-2026-10` with times anchored to the current `simNow` (= 2026-10-24 00:00 at baseline) and sets the clock `RUNNING`.
- Ask gating: an ask with `gatesClock: true` holds the clock while open. "Let time pass" (presenter control) releases the hold. The deadline fallback can then fire.
- `demo:prepare` (CLI): reset namespace `demo` → import history → open periods → run Kestrel and Halden Star scripts with the **real agent** until their stopping states → set the clock to 2026-10-24 00:00, `IDLE`. Then store a **baseline snapshot** (all `demo` rows serialized to Convex storage, `baselineSnapshots` table). `demo.reset` restores from the snapshot in seconds without re-running the agent, and audits `NAMESPACE_RESET`.

## 5. Orchestrator and agent runtime

### 5.1 Tasks
`orchestrator.onWorldEvent(eventId)` maps the event to `agentTasks` (one per affected case; `idempotencyKey = eventId:caseId`). Event → task kind:

| World event | Task kind | Case routing |
|---|---|---|
| `PORT_NOTICE` (advisory) | `FLEET_SCAN` | Agent decides which vessels are affected; may call `open_case` |
| `AIS_BATCH` | `AIS_UPDATE` | Case for that vessel |
| `EMAIL` (NOR/SOF/invoice/reply) | `DOCUMENT_RECEIVED` | Case matched by vessel/IMO in the email |
| `PORT_NOTICE` (closure) | `PORT_NOTICE` | Open cases at that port |
| `MONTH_END` | `MONTH_END` | All open cases (single task, multi-case) |
| `PERIOD_LOCK` | none (system) | — |
| `DEADLINE` | `DEADLINE_CHECK` | Case |
| Ask answered | `ASK_ANSWERED` | Case |

### 5.2 Run loop (`node/agent.runTask`)
1. Acquire a lease (`leaseUntil = now + 90 s`, token). Stale lease → re-queue (bounded attempts: 3).
2. Resolve **capabilities** for this run: `baseGrants(role=agent)` ∪ grants from ACTIVE procedures whose scope matches the case (CONTRACTS §6). Tools outside the capability set are not offered to Claude at all, and are denied at execution if called.
3. Build context (stable → volatile order for prompt caching): system prompt (frozen) → tool definitions (deterministic order) → case snapshot (structured JSON: facts, statements, open asks, applicable memory items with IDs) → the triggering event.
4. Claude call (CONTRACTS §10 for exact parameters): `tool_choice: auto`, `strict: true` tools, adaptive thinking (no display), effort per task kind. Loop until `end_turn` or budget (≤ 12 tool calls, ≤ 60 s wall per call, ≤ 4 min per task).
5. Each tool call executes deterministically and returns typed JSON. Each `record_step` call writes an `agentSteps` row immediately (live UI).
6. **Postcondition verifier** (`src/domain/postconditions.ts`): checks the required outputs for the task kind. On failure, one repair turn with the missing items listed; then `NEEDS_REVIEW` (visible, honest).
7. Release the lease; mark the task `SUCCEEDED | WAITING_HUMAN | NEEDS_REVIEW | FAILED`.

Claude never writes to tables directly. Tools that change state (`propose_*`, `create_ask`, `post_*`, `file_*`, `open_case`) call **gateway** mutations that validate everything again.

### 5.3 What Claude does vs. what code does
| Claude (judgment, language) | Deterministic code (truth) |
|---|---|
| Decide which sources to consult and in what order | Capability checks |
| Read PDFs and extract typed fields with verbatim quotes | Quote-in-text verification; schema validation |
| Classify SOF entries into interval kinds | Interval arithmetic, overlaps, DST-aware UTC conversion |
| Decide whether something needs an ask, and phrase it (≤ 140 chars) | Escalation routing (which role), delegation checks, materiality |
| Write step titles and notes | Laytime statements, money, reconciliation, journals |
| Draft lesson text and the typed payload candidate | Trace diff, classifier gating, backtest, activation |
| Phrase "why?" answers | Provenance graph; citation validation |

## 6. Capabilities (least privilege per run)

A capability is `{ system, access: READ, scope: CASE_VESSEL | CASE_VESSEL_AND_INTERVAL | CASE_COUNTERPARTIES | GLOBAL_READONLY, docKinds? }`.
Base agent grants: `MAILBOX/CASE_VESSEL`, `DOC_STORE/CASE_VESSEL (operational kinds)`, `CONTRACT_REGISTER/CASE_COUNTERPARTIES`, `AIS/CASE_VESSEL`, `PORT_DATA/GLOBAL_READONLY`, `LEDGER/CASE_COUNTERPARTIES`, `COUNTERPARTY_MASTER/GLOBAL_READONLY`, `POLICY_REGISTER/GLOBAL_READONLY`.
`CUSTOMS_PORTAL` is absent until P-CUSTOMS-PORTAL-FIRST is ACTIVE, and then only `CASE_VESSEL_AND_INTERVAL` for cases matching the procedure trigger.
Every tool execution logs `{runId, tool, capabilityId, allowed}`. Denied calls are audited (`TOOL_DENIED`).

## 7. Gateway (the only writer to the books and outbound filings)

Internal mutations only (not callable from the browser):
`gateway.postJournal`, `gateway.fileRecoveryClaim`, `gateway.recordDispute`, `gateway.createAsk`, `gateway.applyAskAnswer`, `gateway.activateMemory`.
Each validates: caller identity (agent run lease or authenticated persona), delegation or explicit approval, period open, balance, idempotency, evidence links. It writes the record plus the audit event atomically. Human mutations (`asks.answer`, `statements.editLine`, `memory.approve`) resolve the persona server-side and then call the same internal gateway functions.

## 8. Audit chain

`auditEvents` per namespace, append-only. `hash = sha256(prevHash ‖ canonicalJSON(eventWithoutHash))`, with `seq` monotonic. Written in the same mutation as the change. `audit.verifyChain(namespace)` recomputes and returns `{ ok, length, firstBadSeq? }` (shown in the Proof tab). Resets append a `NAMESPACE_RESET` event; they never delete audit rows of other namespaces. Within `demo`, reset archives prior events into `auditArchive` with their chain intact.

## 9. Learning pipeline (detail in LEARNING.md)

`asks.answer` (mutation) → stores the answer + human action events → schedules `learning.processAnswer(askId)`:
1. `diff.compute` (pure) → `TraceDiff[]`
2. `lessons.build` (Node; Claude drafts `lessonText` + typed payload; validated) → `lessons`
3. `classifier.classify` (Node; Jev) → `classifierCalls` row
4. `memoryGate.decide` (pure) → memory item status; teach-back ask to the source human if required
5. If PROCEDURE: `backtest.run` (pure over history) → persisted report; Controller ask `APPROVE_MEMORY`

## 10. Explain ("why?")

`explain.why({ entityType, entityId, field })` → `provenance.build` (pure: statement line → facts → evidence docs/AIS windows/clauses/memory items/approvals) → Claude (effort low) phrases ≤ 3 sentences, citing only IDs in the graph. Any citation outside the graph → reject and retry once → fall back to a deterministic template sentence. Cached by `(entityId, field, entityVersion)`.

## 11. Documents pipeline

- **Seed:** `scripts/world/generate-documents.ts` (pdf-lib) writes deterministic PDFs to `fixtures/documents/`. `world.import` uploads them to Convex storage and creates `documents` rows (`system`, `kind`, `vesselId`, `storageId`, `textLayer` extracted once with pdfjs in Node).
- **Agent read:** tool `read_document(docId)` → Node action sends the PDF (base64 document block) to Claude with the kind-specific extraction tool. Each field returns `{value, quote}`. Verifier: the normalized `quote` must occur in `textLayer`, and the value must parse to the field type. Rejected fields are listed back to the model once.
- **Agent write:** `node/letters.generate(kind, caseId)` renders the laytime statement, claim and dispute letters from deterministic data, then stores and links them.
- **Viewer:** pdfjs in center stage. A highlight finds the quote text in the text layer.

## 12. Identity and personas

- On first load, the client signs in with the Convex Auth Anonymous provider (verify the provider import in V00: `@convex-dev/auth/providers/Anonymous`).
- `demoSessions` row per auth user: `{ actingPersonaId }`. Default Observer.
- `session.setActingAs(personaCode)` mutation → audit `ACTING_AS_CHANGED`.
- Every human mutation calls `requirePersona(ctx, allowedRoles)`. It never reads a role from arguments.
- **Separation of duties:** the agent proposes and never approves. Approval actions also check `approverPersonaId ≠ proposerPersonaId` when the proposer is a human.
- Honesty: the Proof tab states "Role toggle selects demo personas; production uses SSO identities."

## 13. Reliability

- Agent task leases, bounded retries, idempotency keys on every side effect (tasks, asks, journals, filings, memory activation).
- Claude failure → the task becomes `FAILED` with a visible state ("Paused: model unavailable · Retry"). Never a fabricated result.
- The Claude request uses server-side refusal fallbacks (`fallbacks: "default"`, CONTRACTS §10). The step shows which model actually served it.
- Jev failure → `classifierCalls.status = ERROR` → gate result `NEEDS_REVIEW` (Controller decides). Never auto-learn without a classification.
- Map tiles failure → bundled coastline.
- All time-based behavior uses `simNow`, never `Date.now()`, except lease and wall-clock metadata.

## 14. Observability

Every material transition: `correlationId` (one per case-task chain), actor (agent run or persona), role, entity, before/after, evidence IDs, capability used, memory items used, model + tokens (agent steps), sim time and wall time.

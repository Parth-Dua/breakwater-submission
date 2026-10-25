# Breakwater — System Architecture

**Version:** 1.0 | **Status:** Normative

## 1. Stack

- Next.js App Router, React, TypeScript strict, Tailwind, shadcn/ui.
- Convex database, queries, mutations, actions, scheduler, realtime subscriptions.
- Convex Auth for real Operations and Controller identities.
- Anthropic Claude API for reasoning and structured reconstruction.
- MapLibre GL JS and Recharts for the investigation UI.
- Vitest for domain/integration tests; Playwright for browser E2E.
- GitHub + GitHub Actions; Vercel for frontend deployment.
- TypeSafe Jev lesson classifier.

Do not introduce SpacetimeDB, Redis, a vector database, real AIS provider, real ERP, or payment processor for the hackathon MVP.

## 2. Component diagram

~~~mermaid
flowchart TB
  subgraph WEB["Next.js / React"]
    CL["Claims + Vessel Timeline"]
    WK["Operations Workbench"]
    MC["Controller + Memory"]
    LA["Ledger + Audit"]
  end
  subgraph CVX["Convex Backend"]
    AUTH["Auth + RBAC"]
    Q["Queries / Validated Mutations"]
    RUN["Durable Agent Runs"]
    EVT["Semantic Observation Events"]
    MEM["Episodes + Procedures"]
    PE["Deterministic Procedure Evaluator"]
    FG["Financial Authorization Gateway"]
    DB[("Persistent Synthetic Records")]
  end
  subgraph MODEL["AI Inference"]
    CLAUDE["Claude API"]
    JEV["Jev Classifier"]
  end
  CL --> Q
  WK --> Q
  MC --> Q
  LA --> Q
  Q --> AUTH
  Q --> DB
  RUN --> CLAUDE
  RUN --> Q
  WK --> EVT
  EVT --> DB
  EVT --> CLAUDE
  EVT -.-> JEV
  CLAUDE --> MEM
  MEM --> PE
  PE --> RUN
  RUN --> FG
  FG --> DB
~~~

## 3. Trust boundaries

**Browser:** authenticated interaction only. No Anthropic secret, no financial authorization decision, no arbitrary journal posting.

**Convex public queries/mutations:** validate input and role. Restrict every read to authorized scope. All material changes create audit events.

**Convex internal actions:** call Claude, run bounded investigation loops, reconstruct episodes. Claude proposes typed tool calls; it cannot call protected financial mutations directly.

**Deterministic domain layer:** calculates charter eligibility, matches procedure scope, validates evidence, checks financial delegation, balances journals.

**Synthetic sources:** invoice and document text is untrusted data; never instructions. A signed flag means a synthetic signed-record fixture, not real cryptographic signature verification.

## 4. Investigation orchestration

1. New claim revision schedules an `agentRun` with correlation ID.
2. Load invoice, claim-packet evidence, AIS, port notices, effective charter, and approved procedures.
3. Claude chooses from a validated, bounded tool set.
4. Policy checks each tool request against current authority. The wider Operations archive is unavailable to the initial agent unless an approved scoped procedure delegates it.
5. Deterministic domain code computes supported/unverified/disputed amounts.
6. Missing operational cause creates one idempotent Operations task.
7. Workflow state becomes `WAITING_HUMAN` and persists.
8. Human submission schedules continuation; resumed run uses the new evidence.
9. A revised invoice may later trigger a financial posting proposal.
10. Protected gateway posts only if every authorization and accounting invariant passes.

The model never chooses final ledger lines without deterministic validation.

## 5. Human learning orchestration

1. Work session opens and records semantic actions.
2. Material user mutations and audit events are atomic.
3. Session completion schedules Claude reconstruction.
4. Reconstruction returns observed sequence, explicit findings, inferred rationale, evidence IDs, and candidate reusable steps.
5. Generalization classifier may mark multiple categories: factual correction, investigation procedure, commercial exception, governance request.
6. Typed DSL candidate is validated and tested on positive and negative fixtures.
7. Controller sees exact scope, test report, provenance, and risks.
8. Approval atomically activates a versioned procedure and grants only its defined tool authority.
9. Later runs retrieve matching active procedures and execute through a generic interpreter.
10. All applications link back to source episode, approval, and version.

## 6. Durable state and retries

Agent run states: `QUEUED`, `RUNNING`, `WAITING_HUMAN`, `WAITING_EXTERNAL`, `SUCCEEDED`, `FAILED_RETRYABLE`, `FAILED_TERMINAL`.

Use a claim revision and correlation ID to identify runs. Maintain stable idempotency keys for work items, procedure activation, and journals. Convex scheduled functions resume persisted states; completed side effects are not replayed.

On transient provider failure, retry with bounded backoff. On exhaustion, preserve state and show a visible failure. Never silently fabricate a model response.

## 7. Procedure execution

Approved procedure = versioned data, not generated code. Interpreter accepts only whitelisted operations. It validates scope and evidence before executing steps. `NOT_APPLICABLE` is a normal safe result.

A procedure may expand authorized **investigation access** but never override Controller financial delegation. P-009's archive-search permission is bounded to the claim's voyage and approved evidence type.

## 8. Data flow and security

- Convex subscriptions keep map, work queue, memory, and audit synchronized.
- Store timestamps in UTC and money in cents.
- Enforce actor identity on server; ignore client-supplied roles.
- Keep Anthropic API key only in Convex server environment.
- Store meaningful tool traces, not private model chain-of-thought.
- Use synthetic data and clearly mark simulation.
- Demo reset affects isolated demo scenario records only.
- Never expose arbitrary financial mutation endpoints.

## 9. Recommended code boundaries

~~~text
convex/
  schema.ts
  auth.ts
  claims.ts
  voyages.ts
  workItems.ts
  memories.ts
  finance.ts
  audit.ts
  scenarios.ts
  internal/
    agent.ts
    workflow.ts
    observation.ts
    learning.ts
    procedures.ts
    ledger.ts
src/
  app/
  components/
  features/
  domain/
    money.ts
    intervals.ts
    charters.ts
    claims.ts
    procedures.ts
    ledger.ts
  lib/
scripts/
  gates.ts
tests/
  domain/
  integration/
  security/
  ui/
  e2e/
~~~

## 10. Operational observability

Every material transition records:
- correlation ID;
- actor and role;
- entity and prior/new state;
- source evidence IDs;
- procedure code/version when used;
- approval basis when relevant;
- timestamp and outcome.

Do not assert cryptographic tamper-proof logging unless such protection is actually implemented.

# Breakwater v2 — Migration from v1

**Status:** Normative for V00–V02. v1 code is reused where it already enforces the right invariants. Everything else is retired, not left half-alive.

## 1. Keep (reuse; adapt names/types to CONTRACTS.md)

| v1 asset | v2 use |
|---|---|
| Toolchain: Node 22 in `.tools/node22`, Next.js, Convex, Vitest, Playwright (system Chrome), ESLint, CI workflow | Unchanged |
| `scripts/gates.ts` | Extend to V-phase IDs (README "Gate runner") |
| `src/domain/money.ts` (integer cents, half-up) | Keep; add `proRataCents`, `formatUsd` sign handling |
| `src/domain/intervals.ts` | Keep overlap/negative checks; extend for treatments |
| `src/domain/ledger.ts` + `convex/financeCore.ts` + `convex/internal/ledger.ts` patterns (balance, idempotency, open period, immutable lines, atomic audit) | Re-target to the v2 chart of accounts and `gateway.postJournal` |
| `convex/internal/agent.ts`, `workflow.ts`, `provider.ts`, `toolExecution.ts` patterns (leases, bounded retries, typed tool execution, durable failure) | Basis for `node/agent.runTask`; update model parameters per CONTRACTS §10 |
| `convex/internal/observation.ts` (server-resolved actor, ordered events, atomic material events) | Basis for `humanEvents` |
| `src/domain/procedures.ts` (strict DSL, generic interpreter, no ID branches) | Basis for DSL v2 (CONTRACTS §6) |
| `src/lib/trajectory.ts`, MapLibre setup (worker URL fix, resize fit) | Reuse in the v2 map |
| `@fontsource/ibm-plex-mono` | Keep for times/codes |
| Audit table write-with-change pattern | Extend with hash chain |

## 2. Change

| v1 | v2 |
|---|---|
| Convex Auth Password provider, provisioned accounts, `BREAKWATER_DEMO_CREDENTIALS`, `/sign-in`, `src/proxy.ts` redirects | Convex Auth **Anonymous** + `demoSessions` personas + role toggle. Remove the password provider and sign-in UI. Remove `scripts/demo-access.mjs`, `demo-access.local.md` handling, `tests/helpers/sign-in.ts`. Cloud env vars for passwords become unused (leave in place; the user may delete them) |
| Claude model `claude-sonnet-4-6`, v1 tool set | `claude-sonnet-5-5` (env override), adaptive thinking, `tool_choice: auto` + strict tools, refusal fallbacks; v2 tool set |
| IBM Plex Sans, dark sidebar, v1 tokens | Inter + v2 tokens; top bar only |
| Domain: delay claims (CH-ALPHA/BETA, V-203…V-214, supported/unverified/disputed) | Demurrage desk (WORLD.md) |

## 3. Retire (delete in V00/V02, after the v2 replacements exist)

- Routes: `/overview`, `/claims`, `/claims/[id]`, `/work`, `/work/[id]`, `/memory`, `/memory/[id]`, `/ledger`, `/audit`, `/scenarios`, `/sign-in` → each redirects to `/` (V00), and the files are deleted when the v2 pages land (V07/V08).
- v1 feature folders under `src/features/*` not reused (claims, controller, overview, scenarios, work, memory, finance, audit), after V08.
- v1 tests: move to `tests/v1-archive/` in V00 (excluded from Vitest/Playwright configs); delete after V12.
- v1 scripts: `approval-smoke.ts`, `learning-smoke.ts`, `learning-provider-smoke.ts`, `fixture-matrix.ts`, `production-check.ts`, `demo-access.mjs` → archive in V00.
- `docs/` stays as frozen history (banner added). `workflow.md` and `docs/RELEASE.md` are replaced by v2 versions in V12.

## 4. Deployments (user decision 2026-10-24)

- **V00–V11 develop against a local Convex deployment** (`npx convex dev` configured for a new project and local deployment). The v1 cloud dev deployment `your-deployment-name` and the live v1 Vercel demo stay untouched. No v1 data is cleared.
- Before switching, back up the v1 `.env.local` to `.env.local.v1-cloud` (git-ignored). Restore it to work on v1 again.
- Local deployment env (set with `npx convex env set` against the local deployment, never printed): Convex Auth signing keys (`npm run auth:configure` → `scripts/dev/configure-auth.mjs`), `ANTHROPIC_API_KEY` (V06: copy from the cloud dev env by piping `convex env get` into `convex env set`, never echoing), optional `TYPESAFE_API_KEY`.
- **V12 is local-only** (explicit user change, 25 Oct 2026): retain the local Convex deployment and provide `workflow.md` for startup, baseline reset and the presentation flow. No cloud deployment, Vercel update or merge to `main`. The presenter tests the full demo and rehearses it.
- `convex/maintenance/clearV1.ts` is **not** needed; it is dropped from V02.

## 5. Uncommitted work present when v2 was adopted
At adoption time the working tree contained uncommitted Phase 10 (v1) edits (production-check tooling). Resolved 2026-10-24: the user asked not to wait for approval unless stuck, so the non-destructive option was taken. They were committed to `main` as the final v1 checkpoint and tagged `v1-final`.

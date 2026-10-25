# V00 — Baseline, Cleanup, Persona Sessions

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 2 h · **Depends on:** v2 spec adopted
**Requirements:** REQ-UI-01 (redirects), REQ-UI-04 (persona basis), CONTRACTS §13.2

## Objective
Prepare the repository for v2 without breaking the toolchain: decide on uncommitted v1 work, replace passwords with persona sessions, extend the gate runner, and archive v1 tests and scripts.

## Sequence
1. Run `git status --short`, `git log -5 --oneline`, `git remote -v`. Commit the uncommitted v1 Phase 10 edits to `main` as the final v1 checkpoint (MIGRATION §5).
2. Tag `v1-final`, create branch `v2`, commit the v2 spec there, push `main`, the tag and `v2`.
2a. Switch the dev backend to a local Convex deployment (MIGRATION §4): back up `.env.local`, configure local, set auth signing env.
3. Extend `scripts/gates.ts`: accept `V00`–`V12`, reject `00`–`10` with a message pointing to `docs_v2/README.md`. Add phase manifests (required files, commands). Add `copy-lint` and the `live` category.
4. Move v1 tests to `tests/v1-archive/`, excluded in `vitest.config.ts` and `playwright.config.ts`. Create `tests/v2/{domain,integration,security,e2e}/`.
5. Archive v1-only scripts (MIGRATION §3) to `scripts/v1-archive/`.
6. Auth: install nothing new; switch `convex/auth.ts` providers to `Anonymous` (verify the import path in the installed `@convex-dev/auth` README/source before writing). Remove the Password provider and the `/sign-in` route. `src/proxy.ts` no longer redirects to sign-in.
7. Add tables `personas`, `demoSessions` (CONTRACTS §3). Seed personas (WORLD §1.1) in ns `demo`. Implement `session.me`, `session.setActingAs`, `requirePersona(ctx, roles)` in `convex/lib/persona.ts`.
8. Client: auto anonymous sign-in on first load (`ConvexAuthProvider` + `useAuthActions().signIn("anonymous")` once).
9. All v1 routes redirect to `/` (temporary placeholder page with the v2 top bar).
10. Tests: S-01, S-02 and the persona round-trip (set → me → audit `ACTING_AS_CHANGED`).

## Required artifacts
`convex/auth.ts` (anonymous), `convex/lib/persona.ts`, `convex/session.ts`, updated `scripts/gates.ts`, `tests/v2/security/persona.test.ts`, `tests/v1-archive/**`, `scripts/v1-archive/**`.

## Acceptance
- [ ] v1 edits preserved on `main` + `v1-final` tag; `v2` branch pushed; local deployment configured.
- [ ] `npm run gate -- V00` passes (lint, typecheck, tests, build).
- [ ] The app loads with no sign-in. The toggle changes the persona server-side (verified in the Convex dashboard or by a test), and the change is audited.
- [ ] No password provider or credential env usage remains in code.
- [ ] v1 routes redirect to `/`.

## Exit
Commit `feat(v00): persona sessions and v2 baseline`, then the checkpoint. Push and verify. Advance to V01.

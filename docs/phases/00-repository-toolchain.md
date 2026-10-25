# Phase 00 — GitHub Repository and Toolchain

**Status:** ACCEPTED | **Estimate:** 1.5–2 h
**Requirements:** REQ-SYS-01, REQ-SYS-05
**Prerequisites:** Node LTS, npm, Git, authenticated GitHub CLI, Convex account.

## Objective
Create a public, remotely backed repository and reproducible Next.js/Convex development environment (visibility updated by user instruction on 2026-10-24).

## Implementation sequence
1. Inspect current directory, Git status, and existing remotes. Never overwrite unrelated work.
2. Initialize Git if needed; use `main` unless existing policy differs.
3. Confirm `gh auth status`. If unauthenticated, record blocker and stop.
4. Use the existing `Parth-Dua/breakwater-submission` repository; set public visibility per user instruction and verify `origin`. Do not create a duplicate repository.
5. Commit/push the original Markdown specification pack before major scaffolding.
6. Scaffold Next.js App Router, strict TypeScript, Tailwind, ESLint.
7. Install Convex, Vitest, Playwright, MapLibre, Recharts, shadcn/ui dependencies, and `tsx`.
8. Add `.gitignore` for `.env*` except `.env.example`, `node_modules`, `.next`, and generated output.
9. Create `.env.example` with public Convex URL and placeholders; never include secrets.
10. Configure Convex and verify actual development deployment connection. If credentials unavailable, mark BLOCKED.
11. Create `scripts/gates.ts`; npm scripts: `lint`, `typecheck`, `test`, `build`, `gate`.
12. Gate runner accepts 00–10, checks required files, executes applicable commands, returns nonzero on failure, and prints JSON result.
13. Create smoke test and GitHub Actions workflow for credential-free checks.
14. Run full Phase 00 gate; commit implementation, update progress, commit checkpoint, push.

## Required artifacts
`package.json`, `tsconfig.json`, Next.js app entry, `convex/schema.ts`, `scripts/gates.ts`, `tests/smoke/toolchain.test.ts`, `.env.example`, `.gitignore`, `.github/workflows/ci.yml`.

## Acceptance criteria
- [x] Actual public GitHub repository exists; `origin` verified (user-directed visibility change).
- [x] Specification baseline and implementation pushed.
- [x] `npm install` succeeds.
- [x] `npm run lint` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run test` passes.
- [x] `npm run build` passes.
- [x] `npm run gate -- 00` passes.
- [x] Convex connectivity verified, not assumed.
- [x] No tracked credentials.
- [x] Repository URL and real SHAs recorded in `progress.md`.

## Failure policy
Missing GitHub/Convex auth is BLOCKED. Do not claim success or silently skip. No fake Git remote or deployment.

## Exit
Commit `chore(phase-00): initialize repository`, then `chore(phase-00): record acceptance checkpoint`; push both, verify remote, start Phase 01 automatically.

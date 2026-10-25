# V01 — Design System, Shell, Copy Linter

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 3 h · **Depends on:** V00
**Requirements:** REQ-UI-02, REQ-UI-03, UI §1–3, §9–11

## Objective
A clean, finance-grade visual base and the two-page shell, so every later screen inherits restraint by default.

## Sequence
1. Install `@fontsource-variable/inter`. Remove IBM Plex Sans imports. Keep IBM Plex Mono.
2. Define the tokens (UI §1.2) as CSS variables in `src/app/globals.css` and map them in the Tailwind v4 theme. Delete the v1 tokens.
3. Components in `src/components/ui/`: `Button` (primary/ghost/danger; sizes sm/md), `Pill`, `Chip` (evidence, memory, delta), `Money` (formats via backend-provided cents; tabular), `TimeText` (sim time, no "UTC"), `Tabs`, `Select`, `Popover`, `Sheet` (bottom), `Skeleton`, `InlineError`, `IconStatus` (fixed icon meanings UI §1.4). No component renders explanatory text.
4. Shell in `src/components/shell/`: `TopBar` (wordmark, company, clock slot, disruption slot, `ActingAs` select bound to `session.setActingAs`, single `SIM` badge, `⋯` menu), `PageGrid` helpers for the Desk and Room grids (UI §4, §5).
5. Routes: `/` renders the Desk skeleton; `/case/[code]` renders the Room skeleton with empty regions at the exact grid sizes.
6. `scripts/copy-lint.ts` (UI §2): scans `src/**/*.tsx` JSX text and string props (`label`, `title`, `placeholder`, `aria-label` excluded from the length rule). Fails on banned terms, > 80-char literals, and more than one `SIM`. Wire it into the gate for V01+.
7. Playwright: U-11 (no page scroll at 1440×900, both routes), U-12 (one SIM, no banned words).
8. Screenshots of both skeletons at 1440×900 and 1280×800. Inspect and record notes.

## Required artifacts
`src/app/globals.css`, `src/components/ui/*`, `src/components/shell/*`, `scripts/copy-lint.ts`, `tests/v2/e2e/shell.spec.ts`, screenshots `artifacts/v2/V01/*.png`.

## Acceptance
- [ ] Tokens and fonts match UI §1 exactly.
- [ ] The copy linter runs in the gate and passes.
- [ ] U-11, U-12 pass. Screenshots reviewed: no clipping, clear hierarchy.
- [ ] `npm run gate -- V01` passes.

## Failure policy
Don't add copy to "explain" the UI. If something needs explaining, the design is wrong.

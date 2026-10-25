# Phase 01 — Design System and Application Shell

**Status:** ACCEPTED | **Estimate:** 2 h
**Depends on:** Accepted Phase 00
**Requirements:** REQ-UI-03, REQ-UI-05, REQ-UI-06

## Objective
Establish a credible maritime-finance visual language and functional route skeleton before feature development.

## Implementation sequence
1. Implement palette, typography, spacing, radius, borders, and financial number styles from `docs/UI.md`.
2. Create responsive 224px desktop sidebar, 64px header, simulation indicator, role/user display, connection state.
3. Add route shells for overview, claims, claim detail, work, work detail, memory, memory detail, ledger, audit, scenarios.
4. Build reusable PageHeader, Stat, DataTable, StatusText, EmptyState, ErrorState, LoadingState, PermissionDenied, and Money components.
5. Use IBM Plex Sans/Mono; align financial values right with tabular numerals.
6. Add a responsive layout and keyboard-visible focus styles.
7. Do not create a fake role switcher; only display authenticated role when available.
8. Use meaningful synthetic labels instead of lorem ipsum; avoid invented performance numbers.
9. Add Playwright navigation and viewport smoke tests.
10. Capture and inspect desktop/mobile screenshots; record clipping, hierarchy, and contrast notes.

## Required artifacts
`src/components/layout/*`, `src/components/ui/*`, `src/lib/format.ts`, route shells, `tests/ui/navigation.spec.ts`.

## Acceptance criteria
- [x] All specified routes render without runtime errors.
- [x] Navigation works and active route is visible.
- [x] Design tokens match UI specification.
- [x] $30,000 formats correctly from 3,000,000 cents.
- [x] UTC timestamps display timezone.
- [x] Desktop and mobile have no horizontal overflow.
- [x] Loading, empty, error, and permission states exist.
- [x] Screenshots captured and visually reviewed.
- [x] `npm run gate -- 01` passes, including lint, typecheck, unit, build, navigation E2E.

## Failure policy
Do not accept placeholder screens that fail navigation or hide overflow. No generic AI chat-first homepage.

## Exit
Commit implementation and progress checkpoint separately, push, verify, advance to Phase 02.

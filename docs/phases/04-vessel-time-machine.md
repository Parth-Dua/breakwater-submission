# Phase 04 — Vessel Time Machine and Claim Reconciliation

**Status:** ACCEPTED | **Estimate:** 4 h
**Depends on:** Accepted Phase 03
**Requirements:** REQ-UI-01, REQ-UI-02, REQ-CLAIM-02, REQ-CLAIM-03

## Objective
Create the signature investigation screen connecting vessel movement, time, source evidence, contract, and financial exposure.

## Implementation sequence
1. Render MapLibre dark maritime map and seeded AIS GeoJSON route.
2. Animate vessel position and heading; distinguish past and future path.
3. Implement timestamp playhead, drag scrub, play/pause, 1x/4x/16x speeds.
4. Detect large AIS gaps; show uncertainty instead of interpolating unsupported movement.
5. Overlay invoice claim interval, port notice, signed log, and unexplained time.
6. Synchronize map marker, timestamp, active evidence, and financial exposure.
7. Clicking evidence moves the timeline to its interval.
8. Selected time range displays claimed/evidenced minutes.
9. Implement reconciliation panel, source drawer, charter clause preview, and tool-trace placeholder.
10. Use Convex subscriptions and deterministic financial calculations, not component-local invented totals.
11. Implement keyboard timeline controls and reduced-motion behavior.
12. Optimize animation to avoid full-page rerenders per frame.
13. Add Playwright synchronization tests and screenshot review.

## Required artifacts
`src/features/voyage/TimeMachine.tsx`, `TrajectoryMap.tsx`, `Timeline.tsx`, `src/features/claims/ReconciliationPanel.tsx`, `EvidencePanel.tsx`, `src/lib/trajectory.ts`, `tests/ui/time-machine.spec.ts`.

## Acceptance criteria
- [x] Scrub updates marker, timestamp, and active evidence.
- [x] Evidence click jumps to source interval.
- [x] AIS gap shown explicitly, not interpolated.
- [x] AIS never used as proof of operational cause.
- [x] V-203 clearly shows $20k unverified.
- [x] All financial figures match backend data.
- [x] Play/pause and speed controls work.
- [x] Keyboard and reduced-motion modes work.
- [x] Desktop/mobile screenshots reviewed.
- [x] `npm run gate -- 04` passes.

## Failure policy
No static map image, decorative fake animation, or unsupported causal claim.

## Exit
Commit/push implementation and progress checkpoint; advance to Phase 05.

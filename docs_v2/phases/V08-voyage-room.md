# V08 — Voyage Room (map, timeline, thinking, memory list, money)

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 6 h · **Depends on:** V07
**Requirements:** REQ-UI-01..05, REQ-AGT-02, REQ-AUD-02 (UI part), UI §5–6

## Objective
One vessel, one disruption: watch the agent work in real time against the physical world and the money.

## Sequence
1. Queries `room.*` (CONTRACTS §11).
2. Map (`src/features/room/Map.tsx`): MapLibre with the OpenFreeMap positron style (verify the style URL loads; otherwise use the bundled coastline). Geofences, past track, vessel marker interpolated on clock jumps, NOR ✕ pin with a distance line, shifting highlight, AIS gap dashes, no future path. Reuse the v1 worker and resize fixes.
3. Timeline (`Timeline.tsx`): five lanes (UI §5.3), playhead = simNow, view cursor + Live, keyboard, hover tooltips, doc pins → DOCUMENT mode.
4. Rail: `ThinkingFeed` (NOW card + done list + expansion + used-memory chips), `MemoryList` (sections, rows, expansion skeleton; full content in V10), pinned `AskCard`.
5. `MoneyStrip` with the Why? popover (`explain.why` action: deterministic template until V11 adds Claude phrasing) and the Journals sheet.
6. `DocumentViewer` (pdfjs; quote highlight; ← Map).
7. Center stage mode switch per UI §5.1 (work surfaces render placeholders until V09).
8. E2E: U-13, U-15, U-17, U-18, U-19; screenshot U-03 from a live run.

## Required artifacts
`src/app/case/[code]/page.tsx`, `src/features/room/**`, `convex/room.ts`, `public/geo/*.json`, `tests/v2/e2e/room.spec.ts`.

## Acceptance
- [ ] A live Aster Vale run shows steps appearing in the NOW card and the list, the map following the vessel, and the NOR pin with the computed distance.
- [ ] Each financial metric appears once (equal values across distinct metrics/ledger records are allowed per UI §2.3); the role toggle changes only center stage.
- [ ] Screenshots reviewed at 1440×900 and 1280×800; `npm run gate -- V08` passes.

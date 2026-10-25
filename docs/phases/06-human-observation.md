# Phase 06 — Operations Workbench and Semantic Observation

**Status:** ACCEPTED | **Estimate:** 3 h
**Depends on:** Accepted Phase 05
**Requirements:** REQ-OBS-01..04, REQ-UI-03

## Objective
Let an Operations Reviewer resolve a genuine agent escalation through ordinary application work, while preserving a faithful semantic event record.

## Implementation sequence
1. Build role-filtered work queue and Operations task detail.
2. Show precise agent question, missing interval, amount at risk, completed checks, and evidence.
3. Embed synchronized vessel timeline and searchable Operations archive.
4. Implement document preview, interval comparison, and evidence linking.
5. Implement structured cause finding, correction, unavailable evidence, clarification, and reassignment.
6. Create work session on claim/open and record `WORK_SESSION_STARTED`.
7. Emit `ARCHIVE_SEARCHED`, `EVIDENCE_OPENED`, `TIMELINE_RANGE_SELECTED`, `EVIDENCE_COMPARED`, `EVIDENCE_LINKED`, and finding events from actual interactions.
8. Throttle view events; never capture keystrokes or per-frame timeline events.
9. Derive actor/role from server auth; validate source IDs and voyage match.
10. Atomically store submitted finding, material observation, and audit event.
11. Close session and resume agent workflow.
12. Add integration and browser tests for actual user sequence and unauthorized access.

## Required artifacts
`src/features/work/OperationsWorkbench.tsx`, `ArchiveSearch.tsx`, `FindingForm.tsx`, `convex/workItems.ts`, `convex/internal/observation.ts`, `tests/integration/observation.test.ts`.

## Acceptance criteria
- [x] Reviewer can search archive and find signed customs log.
- [x] Reviewer links evidence to V-203 and submits cause.
- [x] Complete event history exists with actual actor, time, evidence IDs.
- [x] Final finding explicitly references source.
- [x] Viewing a document alone does not assert human conclusion.
- [x] Agent resumes automatically after submission.
- [x] No event storm during playback.
- [x] Operations cannot change financial policy.
- [x] No manual written tutorial is required.
- [x] `npm run gate -- 06` passes.

## Failure policy
No preseeded fake observation history or narrated-only workflow.

## Exit
Commit/push implementation and checkpoint; advance to Phase 07.

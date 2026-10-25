# Breakwater — UI and Interaction Specification

**Version:** 1.0 | **Status:** Normative

## 1. Design intent

An enterprise maritime-finance operations terminal, not an AI chat app. Formal typography, compact evidence-rich panels, clear financial hierarchy, and functional vessel animation.

Use IBM Plex Sans for interface text and IBM Plex Mono for financial figures, IDs, and timestamps.

### Tokens
- Background `#F5F6F3`
- Surface `#FFFFFF`
- Text `#17232E`
- Secondary `#60717D`
- Deep navy `#101E2A`
- Ocean `#102735`
- Land `#253E48`
- Verified teal `#17766F`
- Unverified amber `#B47A24`
- Disputed red `#B44843`
- Border `#DCE3E4`

Desktop sidebar 224px; header 64px; base spacing 4px; card radius 8px; minimal shadows; right-aligned tabular financial figures.

## 2. Global shell

Sidebar: Overview, Claims, Work Queue, Institutional Memory, Ledger, Audit Trail. Scenario Controls visible only to demo admin.

Header: Meridian Commodities, Simulation indicator, authenticated role/user, global search, connection status.

Do not use a frontend role switcher as authorization. Demo identities must be authenticated or explicitly gated.

## 3. Overview

Summary: open exposure, unverified amount, disputed amount, Operations tasks, Controller tasks, autonomous resolutions. Below: high-risk claims, latest agent activity, work queue, voyage highlights.

All metrics are derived from Convex; no fabricated percentages.

## 4. Claims table

Columns: claim, vessel, voyage, carrier, claimed, supported, unverified, disputed, status, updated. Default sort by unresolved exposure. Filter by status, vessel, carrier, assigned role, amount.

Use statuses such as "Evidence incomplete", "Operations review required", "Awaiting revised invoice", "Controller approval required", "Ready for posting", "Posted".

## 5. Claim detail

At desktop >=1280px:
- Header: claim, vessel, charter, status, exposure.
- Left approximately 65%: vessel map and synchronized timeline.
- Right approximately 35%: financial reconciliation, contract, source evidence.
- Below: agent tool trace, work items, journal activity.

Responsive tablet stacks panels. Mobile remains usable for read/review.

### Vessel time machine
- MapLibre dark maritime map with synthetic route.
- Animated vessel marker, heading, past/future path.
- Time ruler with invoice, port notice, Operations log, and uncertainty windows.
- Scrub, play/pause, speeds 1x/4x/16x, jump to next evidence.
- Scrub updates marker, active event, financial interval, and timestamp.
- Evidence click moves playhead to referenced interval.
- Selected time range shows claimed/evidenced minutes and emits a debounced semantic event.
- Gaps larger than interpolation threshold show dashed uncertainty; never invent vessel movement.
- Keyboard arrows, spacebar when focused, Escape to clear selection.
- Reduced motion disables autoplay; accessible tabular fallback.

### Financial reconciliation
Always show claimed, supported, unverified, disputed, rate, minutes, charter version, source references, and posting state. Compact stacked bar/waterfall allowed. All values from deterministic backend calculations.

V-203 before human review: "48 hours require cause verification."
After review: "48 hours excluded under CH-ALPHA v1, clause 7.2."

Never say "customs is never payable."

## 6. Operations workbench

Heading: "Review delay cause — V-203".

Show exact question, affected interval, amount at risk, completed agent checks, and evidence gaps.

Panels:
- synchronized vessel time machine;
- searchable Operations archive;
- document preview;
- comparison of evidence intervals;
- structured finding form.

Actions: search, open, compare, link, select cause, correct finding, mark unavailable, submit, request clarification.

Canonical review must be completable without a written tutorial. Capture semantic actions, not screen recordings.

## 7. Controller workbench

Procedure review displays:
- source episode and human action sequence;
- explicit versus inferred steps;
- typed DSL;
- scope and exclusions;
- positive and negative tests;
- risk and authority impact;
- approval/rejection/revision controls.

Narrowing scope requires retest. Procedure approval and financial journal approval are distinct actions.

Financial review displays journal lines, source invoice, accrual, accounting period, delegation, and exception reason.

## 8. Memory explorer

Tabs: Approved, Proposed, Case History, Exceptions, Revoked.

Detail: summary, provenance, observed/inferred steps, scope, typed plan, test results, version, approval, revocation, executions, before/after comparison.

Before/after must be based on actual recorded runs, never fabricated performance numbers.

## 9. Ledger and audit

Ledger tabs: Journal Entries, Accruals, AP, Accounting Periods. Journal detail displays balanced lines, source, approval, period, idempotency key, audit link.

Audit filters: claim, voyage, actor, event type, time range. Distinguish model proposal, tool action, human finding, approval, and posting. Do not expose private chain-of-thought as trace.

## 10. Error and accessibility requirements

Every major view has loading, empty, permission denied, error, reconnecting, running, waiting, blocked, and completed states.

Errors:
- "Investigation paused. The last completed step is preserved."
- "Procedure not applied: charter scope differs."
- "Posting requires Controller approval."

WCAG AA-oriented contrast, visible focus, semantic labels, keyboard controls, reduced motion, and text indicators alongside color.

## 11. Required visual evidence

Capture and inspect:
1. Overview desktop.
2. V-203 map with $20k unverified exposure.
3. Operations workbench with linked signed log.
4. Controller procedure approval and tests.
5. Memory evolution before/after.
6. Balanced ledger detail.
7. Mobile claim detail.

Record hierarchy, clipping, density, typography, contrast, and interaction defects in `progress.md`.

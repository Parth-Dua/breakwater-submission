# Phase 10 — Deployment, Visual QA, and Demo Release

**Status:** IN_PROGRESS | **Estimate:** 2.5–3 h
**Depends on:** Accepted Phase 09
**Requirements:** REQ-SYS-04, REQ-SYS-05, REQ-UI-06
**External dependencies:** Vercel, Convex production deployment, Anthropic key.

## Objective
Deliver a stable, polished, publicly accessible five-minute judge demonstration.

## Implementation sequence
1. Deploy Convex backend and configure server secrets securely.
2. Deploy Next.js frontend to Vercel with correct Convex public URL.
3. Verify authenticated Operations, Controller, and demo-admin access.
4. Verify real Claude call in deployed environment.
5. Confirm MapLibre assets, fallback geometry, charts, and realtime updates load.
6. Run all prior phase gates and full regression.
7. Run deployed Playwright end-to-end flow from fresh reset.
8. Capture all seven screenshots specified in `docs/UI.md`.
9. Review visual hierarchy, spacing, typography, density, contrast, clipping, motion, and keyboard access.
10. Verify observed human session creates new candidate and approval activates it.
11. Verify V-204 autonomous reuse, V-205 different-charter safety, and goodwill non-generalization.
12. Verify balanced ledger and source-linked audit.
13. Rehearse `docs/DEMO.md` and measure actual duration.
14. Verify reset and repeatability.
15. Verify GitHub remote is current and CI passes.
16. Record deployment URL, SHA, gate results, screenshot paths, and known limitations.

## Required artifacts
Deployed application, production Convex configuration, screenshot evidence, completed `progress.md`, updated README if needed, release test results.

## Acceptance criteria
- [ ] Public deployment loads without broken routes.
- [ ] Production Convex connected and auth enforced.
- [ ] Live Claude call succeeds; no silent mock provider.
- [ ] Canonical end-to-end demo passes from fresh reset.
- [ ] P-009 generated from observed work and Controller-approved.
- [ ] V-204 avoids repeat escalation.
- [ ] V-205 respects its own charter.
- [ ] $15k reversal and $10k AP are balanced and traceable.
- [ ] Required screenshots inspected.
- [ ] No obvious clipping, placeholder, or broken state on demo path.
- [ ] Full regression, CI, and `npm run gate -- 10` pass.
- [ ] Actual rehearsal duration recorded.
- [ ] GitHub/deployment URLs and final SHA recorded.
- [ ] `progress.md` status is RELEASE_ACCEPTED.

## Failure policy
Do not release with failed financial invariants, fabricated learning, unverified Claude integration, or failing deployed E2E. Reduce optional polish before reducing controls.

## Exit
Commit/push release checkpoint. Report repository URL, deployment URL, final SHA, verification summary, live demo outcome, and limitations. Stop automatic feature development.

## Execution decision
User explicitly authorized continued implementation through deployment while genuine human evidence remains pending. Verify the user-created Vercel demo against its configured Convex cloud environment; preserve every unmet production and human release requirement in the checkpoint.

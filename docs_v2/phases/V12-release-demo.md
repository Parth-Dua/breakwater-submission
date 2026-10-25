# V12 — Local Demo Handoff

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Depends on:** V11
**Authority:** Explicit user change, 25 Oct 2026. Local presentation only; no Vercel/Convex cloud deployment, full demo rerun, video or agent-run rehearsals.

## Objective
Provide a concise, reproducible local demo guide so the presenter can test the flow and restore the same prepared baseline for every judge.

## Deliverable
Replace `workflow.md` with the local handoff: prerequisites and two-terminal startup; localhost URL; reset to the prepared baseline; one-time recovery/preparation instructions separated from normal reset; exact Acts 1–3 and intended visible behavior; expected WORLD amounts; short network/troubleshooting notes. Never include secret values.

## Acceptance
- [ ] `workflow.md` gives exact runnable startup and reset commands.
- [ ] It explains the precise Ops → scope → Controller memory approval → disruption → Trader partial → Controller edit/teach-back → Proof flow, with concise expected behavior and exact WORLD amounts.
- [ ] `docs_v2/` consistently records local-only V12 and user-owned full demo/rehearsal testing.
- [ ] Review commands against current scripts/backend and the saved baseline. No full demo/provider rerun is required.
- [ ] Publish the independent source repository on `main`.

## Out of scope (supersedes original V12)
Cloud deployment, Vercel configuration, merge/push to `main`, deployed T-20, videos, timed rehearsals and repeated V00–V11 full gates. V11's actual local score/Why evidence remains required. Leave archived v1 assets untouched during this handoff.

Validation is not run for this source snapshot. Preparation and full presentation testing require an explicit request and project-specific credentials.

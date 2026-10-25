# Breakwater — Source checkpoint

Date: 25 October 2026
Repository: https://github.com/Parth-Dua/breakwater-submission
Branch: `main`

## Implemented source

The desk includes deterministic laytime and journal engines, Convex work orchestration, document and AIS evidence, role-specific asks, semantic action capture, Jev lesson classification, typed memory gating, procedure backtests, approval controls, audit verification and a Proof scoreboard.

Jev is the classifier throughout the runtime, stored classifier identities and calibration entry point. TypeSafe and OpenRouter are transports for Jev. Credentials belong in the project's own Convex environment. Classifier service failure leaves a recorded error and a reviewable candidate; it cannot activate memory.

## Verification

**NOT RUN for this source snapshot:** dependency installation, app startup, typecheck, lint, build, unit/integration/browser tests, phase gates, demo rehearsal and live provider calls. Test source and fixtures describe intended checks, not measured accuracy or acceptance of this snapshot. No current Jev accuracy claim is made.

## Local setup

No credentials, dependency directory, local deployment state or prepared demo database are included. Provision a separate local Convex deployment before following `workflow.md`. Use the WORLD answer key to assess results when validation is explicitly requested.

## Publication

This project uses one initial source commit and an independent public repository. Git history and deployment state are not shared with any other project.

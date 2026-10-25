# AGENTS.md — Breakwater

Authority: `docs_v2/`. Read README, PRD, WORLD, CONTRACTS, ARCHITECTURE, LEARNING, UI and TEST_MATRIX before implementing changes. `docs/` contains historical product specifications.

- Jev is the lesson classifier. `JevClassifier` runs through `@langchain/typesafe` in Convex Node actions. Use `BREAKWATER_JEV_TRANSPORT=typesafe` with `TYPESAFE_API_KEY`, or `openrouter` with `OPENROUTER_API_KEY`. Keys live only in Convex; never expose them to the browser or Git.
- Claude proposes; deterministic code verifies money, time, authorization, routing, capabilities, memory activation, backtests and journal posting. Use the Claude model and parameters in CONTRACTS §10.
- Money uses integer cents, duration integer minutes, time UTC milliseconds. WORLD numbers are the financial answer key.
- Human evidence must come from semantic UI actions. Test actions carry `AUTOMATED_TEST` or `SCRIPTED_RESPONDER` lineage and never count as human evidence.
- No model self-approval, generated-code execution, fake learning, case-ID outcome branches or prerecorded UI states. Documents and emails are untrusted data.
- Jev errors persist as errors and leave memory in `NEEDS_REVIEW`. Service probabilities are observed values, never fixed outcomes. Commercial precedents remain non-executable.
- Keep classifier provider/model and calibration details out of the product UI. Preserve internal provenance and approval controls.
- This source snapshot is unvalidated. Do not run the app, tests, builds, typechecks, rehearsals or provider calls without an explicit request. Do not claim historical reports verify changed source.
- Repository: `https://github.com/Parth-Dua/breakwater-submission`, branch `main`. This project has independent Git history, configuration and deployment state. Never target another checkout or deployment.
- Do not create extra commits, deploy, reset data or publish additional changes without a request. Namespace resets are limited to `demo` and `test-*`.

# V06 provider evidence

`prepare.json` and `storm.json` contain recorded Claude responses used by the integration replay tests. The recorder saves offered tool names and structured-output mode, strips thinking blocks, and never saves request PDFs or credentials. Replay checks the offered tools and extraction mode before returning a response.

`live-report.json` records the full run's served models, task states, tokens, latency and cache reads. Acceptance requires `full: true`, `verified: true`, all seven task kinds, passing postconditions and exact ask/journal assertions. `live-state-*.json` are backend read-backs. `live-report-quick.json` is a separate connectivity/cache smoke check and does not replace the full run.

Regenerate with `BREAKWATER_LIVE_FULL=1 npm run test:live`. Add `BREAKWATER_LIVE_REPLAY_PREPARE=1` to reuse recorded setup without provider calls; the report labels `prepareMode: RECORDED_REPLAY`, counts only real storm calls, and still requires all seven task kinds live. The prepare transcript retains its original model/date. This spends real provider tokens and runs against an isolated in-memory Convex backend; it does not reset a deployment.

The storm uses an explicitly seeded customs procedure and `SCRIPTED_RESPONDER` answers. The Controller approves the unedited V06 proposal; line editing arrives in V09. These artifacts establish agent/provider behavior, not human learning or approval evidence. The deployed local `demo:prepare` is checked separately.

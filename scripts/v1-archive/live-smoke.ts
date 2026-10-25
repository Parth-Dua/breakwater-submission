import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const result = spawnSync("node_modules/.bin/convex", ["run", "internal/provider:smoke", JSON.stringify({ claimCode: "CL-203" })], { encoding: "utf8", timeout: 150_000 });
let response: { live?: boolean; code?: string; tool?: string; model?: string; inputTokens?: number; outputTokens?: number } = {};
try { response = JSON.parse(result.stdout); } catch { /* Never echo raw CLI output: auth/config diagnostics can contain credentials. */ }
const passed = result.status === 0 && response.live === true && response.code === "LIVE_TOOL_ROUND_TRIP_VERIFIED" && response.tool === "get_claim_snapshot" && !!response.model && (response.inputTokens ?? 0) > 0 && (response.outputTokens ?? 0) > 0;
const report = { provider: "Anthropic", environment: "Convex cloud server action", data: "Seeded synthetic claim fixture only; no credentials sent as tool content", status: passed ? "PASS" : "FAIL", code: response.code ?? "LIVE_SMOKE_UNAVAILABLE", model: response.model, tool: response.tool, inputTokens: response.inputTokens, outputTokens: response.outputTokens, verifiedAt: new Date().toISOString() };
mkdirSync("artifacts/live", { recursive: true }); writeFileSync("artifacts/live/claude.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report, null, 2));
if (!passed) process.exit(1);

// Breakwater v2 phase gate runner (docs_v2/README.md "Gate runner").
// Usage: npm run gate -- VXX [--ci]
//   --ci  credential-free mode: skips checks that need a running Convex backend or live providers (reported NOT_RUN).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { agentModel } from "../convex/node/claude";
import { spawn, spawnSync } from "node:child_process";
import { savedLearningEvidence } from "./live/learning-evidence";
import { savedJevEvidence } from "./live/jev-evidence";
import {savedProofEvidence} from "./live/proof-evidence";

type Status = "PASS" | "FAIL" | "NOT_RUN";
type Check = { name: string; status: Status; category: "static" | "local" | "e2e" | "live"; detail?: string; durationMs?: number };
type Manifest = { files: string[]; copyLint?: boolean; e2e?: boolean; live?: string[] };

const started = Date.now();
const args = process.argv.slice(2);
const ci = args.includes("--ci");
const reuseLive = args.includes("--reuse-live");
const phase = args.find(arg => !arg.startsWith("--"));

function finish(status: "PASS" | "FAIL", checks: Check[]) {
  const summary = { phase: phase ?? null, mode: ci ? "ci" : "full", status, checks, durationMs: Date.now() - started, verifiedAt: new Date().toISOString() };
  mkdirSync("artifacts/gates", { recursive: true });
  if (phase && /^V\d\d$/.test(phase)) writeFileSync(`artifacts/gates/${phase}.json`, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(status === "PASS" ? 0 : 1);
}

if (phase && /^(0[0-9]|10)$/.test(phase)) {
  finish("FAIL", [{ name: "phase", status: "FAIL", category: "static", detail: "v1 phase IDs are retired. Use V00–V12 (see docs_v2/README.md)." }]);
}
if (!phase || !/^V(0\d|1[0-2])$/.test(phase) || args.filter(arg => !arg.startsWith("--")).length !== 1) {
  finish("FAIL", [{ name: "phase", status: "FAIL", category: "static", detail: "Expected exactly one phase ID V00–V12" }]);
}

// Required artifacts per phase (docs_v2/phases/*). Gates are cumulative: VXX checks V00..VXX.
const MANIFESTS: Record<string, Manifest> = {
  V00: { e2e: true, files: ["docs_v2/README.md", "AGENTS.md", "convex/auth.ts", "convex/lib/persona.ts", "convex/session.ts", "scripts/gates.ts", "tests/v2/security/persona.test.ts", "tests/v1-archive", "scripts/v1-archive"] },
  V01: { e2e: true, copyLint: true, files: ["src/app/globals.css", "src/components/ui", "src/components/shell", "scripts/copy-lint.ts", "tests/v2/e2e/shell.spec.ts"] },
  V02: { files: ["convex/schema.ts", "src/world", "scripts/world/generate-history.ts", "scripts/world/generate-scoreboard.ts", "fixtures/world", "convex/world/import.ts", "tests/v2/domain/world.test.ts"] },
  V03: { files: ["scripts/world/templates", "scripts/world/generate-documents.ts", "fixtures/documents", "convex/node/documents.ts", "convex/sources", "tests/v2/integration/sources.test.ts"] },
  V04: { files: ["convex/sim.ts", "convex/world/release.ts", "convex/orchestrator.ts", "scripts/demo/prepare.ts", "convex/demo.ts", "tests/v2/integration/sim.test.ts"] },
  V05: { files: ["src/domain/money.ts", "src/domain/time.ts", "src/domain/geo.ts", "src/domain/nor.ts", "src/domain/laytime.ts", "src/domain/reconcile.ts", "src/domain/ledger.ts", "src/domain/policy.ts", "src/domain/capabilities.ts", "src/domain/postconditions.ts", "src/domain/provenance.ts", "convex/gateway.ts", "convex/audit.ts", "tests/v2/integration/gateway.test.ts"] },
  V06: { live: ["test:live"], files: ["convex/node/claude.ts", "convex/node/prompts/agent.ts", "convex/node/tools", "convex/node/agent.ts", "fixtures/agent-transcripts", "tests/v2/integration/agent.test.ts", "scripts/live/agent-smoke.ts"] },
  V07: { e2e: true, files: ["src/features/desk", "convex/desk.ts", "convex/books.ts", "tests/v2/e2e/desk.spec.ts"] },
  V08: { e2e: true, files: ["src/app/case/[code]/page.tsx", "src/features/room", "convex/room.ts", "public/geo", "tests/v2/e2e/room.spec.ts"] },
  V09: { e2e: true, files: ["src/features/work/OpsDesk.tsx", "src/features/work/StatementEditor.tsx", "src/features/work/RecoveryDecision.tsx", "src/features/work/TeachBackCard.tsx", "convex/asks.ts", "convex/statements.ts", "tests/v2/integration/human-work.test.ts", "tests/v2/e2e/human-work.spec.ts"] },
  V10: { e2e: true, files: ["src/domain/diff.ts", "src/domain/memory-gate.ts", "src/domain/backtest.ts", "src/domain/precedent-search.ts", "convex/node/lessons.ts", "convex/node/classifier/index.ts",  "convex/node/classifier/jev.ts", "convex/learning.ts", "convex/memory.ts", "fixtures/learning/calibration.json", "fixtures/classifier/jev-response.sample.json", "tests/v2/integration/learning.test.ts", "tests/v2/e2e/learning.spec.ts"] },
  V11: { e2e: true, files: ["convex/node/explain.ts", "scripts/score/run.ts", "convex/proof.ts", "tests/v2/integration/explain.test.ts", "tests/v2/integration/score.test.ts", "tests/v2/e2e/proof.spec.ts"] },
  V12: { e2e: true, files: ["README.md", "workflow.md"] },
};

const phaseNumber = Number(phase!.slice(1));
const phases = Object.keys(MANIFESTS).filter(id => Number(id.slice(1)) <= phaseNumber);
const checks: Check[] = [];

// 1. Secrets in tracked files.
const tracked = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
const trackedFiles = tracked.stdout?.split("\0").filter(Boolean) ?? [];
const secretFiles = trackedFiles.filter(file => /(^|\/)\.env($|\.)/.test(file) && file !== ".env.example");
const secretPatterns = [/\bsk-ant-[A-Za-z0-9_-]{16,}/, /\bsk-or-v1-[A-Za-z0-9_-]{16,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
const secretsFound = trackedFiles.filter(file => existsSync(file) && !/\.(png|jpg|pdf|woff2?)$/i.test(file) && secretPatterns.some(pattern => pattern.test(readFileSync(file, "utf8"))));
checks.push({ name: "repository:secrets", category: "static", status: tracked.status === 0 && !secretFiles.length && !secretsFound.length ? "PASS" : "FAIL", detail: [...secretFiles, ...secretsFound].join(", ") || undefined });

// 2. Required artifacts (cumulative).
for (const id of phases) {
  const missing = MANIFESTS[id].files.filter(file => !existsSync(file));
  checks.push({ name: `artifacts:${id}`, category: "static", status: missing.length ? "FAIL" : "PASS", detail: missing.join(", ") || undefined });
}
if (checks.some(check => check.status === "FAIL")) finish("FAIL", checks);

// 3. Commands.
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
function run(name: string, category: Check["category"], command: string[], options: { onFail?: () => void } = {}) {
  const before = Date.now();
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", env: { ...process.env, BREAKWATER_GATE_PHASE: phase!, BREAKWATER_REUSE_LIVE: reuseLive ? "1" : "0" } });
  const check: Check = { name, category, status: result.status === 0 ? "PASS" : "FAIL", durationMs: Date.now() - before };
  checks.push(check);
  if (check.status === "FAIL") { options.onFail?.(); finish("FAIL", checks); }
}
run("lint", "local", ["npm", "run", "lint"]);
run("typecheck", "local", ["npm", "run", "typecheck"]);
if (phases.some(id => MANIFESTS[id].copyLint)) run("copy-lint", "local", ["npx", "tsx", "scripts/copy-lint.ts"]);
run("test", "local", ["npm", "run", "test"]);
run("build", "local", ["npm", "run", "build"]);

const needsE2e = phases.some(id => MANIFESTS[id].e2e);
if (needsE2e) {
  if (ci) checks.push({ name: "e2e", category: "e2e", status: "NOT_RUN", detail: "--ci: requires a running Convex backend" });
  else {
    // E2E must exercise the current code: the gate starts the LOCAL Convex deployment itself, waits for a
    // successful push of the working tree, runs Playwright, then stops it (never cloud; MIGRATION §4).
    const deployment = readEnvLocal("CONVEX_DEPLOYMENT") ?? "";
    if (!deployment.startsWith("local:")) {
      checks.push({ name: "e2e:backend", category: "e2e", status: "FAIL", detail: `Refusing to use non-local deployment "${deployment}"` });
      finish("FAIL", checks);
    }
    const url = readEnvLocal("NEXT_PUBLIC_CONVEX_URL") ?? "http://127.0.0.1:3210";
    if (probe(url)) {
      checks.push({ name: "e2e:backend", category: "e2e", status: "FAIL", detail: "A local Convex backend is already running. Stop `npx convex dev`; the gate manages the backend so E2E runs against the current code." });
      finish("FAIL", checks);
    }
    const before = Date.now();
    const backend = await startLocalBackend();
    checks.push({ name: "e2e:backend", category: "e2e", status: backend.ok ? "PASS" : "FAIL", detail: backend.ok ? undefined : backend.detail, durationMs: Date.now() - before });
    if (!backend.ok) { backend.stop(); finish("FAIL", checks); }
    run("e2e", "e2e", ["npm", "run", "test:e2e"], { onFail: backend.stop });
    backend.stop();
  }
}

// 4. Live-provider checks are reported separately and never mixed with mocked results.
for (const id of phases) for (const script of MANIFESTS[id].live ?? []) {
  if (ci) { checks.push({ name: `live:${script}`, category: "live", status: "NOT_RUN", detail: "--ci" }); continue; }
  if (reuseLive && script === "test:live") {
    const path = "fixtures/agent-transcripts/live-report.json";
    const report = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as { model: string; full: boolean; verified: boolean; ranAt: string; rows: { kind: string; state: string; ms: number; cacheRead: number }[] } : null;
    const kinds = ["AIS_UPDATE", "ASK_ANSWERED", "DEADLINE_CHECK", "DOCUMENT_RECEIVED", "FLEET_SCAN", "MONTH_END", "PORT_NOTICE"];
    const beganAt = report ? Date.parse(report.ranAt) - report.rows.reduce((sum, row) => sum + row.ms, 0) : 0;
    const sourceFiles: string[] = [];
    const visit = (path: string) => {
      if (!existsSync(path)) return;
      if (statSync(path).isDirectory()) for (const name of readdirSync(path)) { if (name !== "_generated") visit(`${path}/${name}`); }
      else if (/\.(ts|json)$/.test(path) && !path.endsWith(".d.ts")) sourceFiles.push(path);
    };
    for (const path of ["convex/agent", "convex/node", "convex/sources", "convex/lib", "convex/gateway.ts", "convex/asks.ts", "convex/orchestrator.ts", "convex/sim.ts", "convex/schema.ts", "src/domain", "src/world", "src/documents", "tests/v2/helpers", "fixtures/world"]) visit(path);
    const changed = sourceFiles.filter(path => statSync(path).mtimeMs > beganAt);
    const learning = phaseNumber >= 10 ? savedLearningEvidence() : null;
    const jev = phaseNumber >= 10 ? savedJevEvidence() : null;
    if (phaseNumber >= 10) checks.push({ name:"live:jev-calibration",category:"live",status:jev?"PASS":"NOT_RUN",detail:jev?`Actual OpenRouter ${jev.probe.result.model}; probe ${jev.probe.latencyMs} ms; calibration ${jev.calibration.correct}/${jev.calibration.total}. Accuracy is measured, not a passing-quality claim.`:"No real Jev calibration recorded" });
    const proof=phaseNumber>=11?savedProofEvidence():null;
    if(phaseNumber>=11)checks.push({name:"live:proof-score",category:"live",status:proof?"PASS":"FAIL",detail:proof?"Actual 24-voyage score, grounded live Why, verified audit and current UI/source hashes; earlier scenario evidence retained without repeating the demo.":"Current-source score/Why/browser evidence required"});
    if (phaseNumber >= 10) checks.push({ name: "live:learning-ui", category: "live", status: learning ? "PASS" : "FAIL", detail: learning ? `Actual ${learning.model} run ${learning.ranAt}: three classifier-backed outcomes, unseeded procedure with 6/6 backtest and real use, all seven task kinds, exact corrected money; AUTOMATED_TEST, humanEvidence:false.` : "Current-source V10 learning evidence required" });
    const ok = Boolean(report?.full && report.verified && report.model === agentModel() && report.rows.every(row => ["SUCCEEDED", "WAITING_HUMAN"].includes(row.state)) && kinds.every(kind => report.rows.some(row => row.kind === kind)) && report.rows.some(row => row.cacheRead > 0) && (phaseNumber < 10 || learning) && (phaseNumber < 11 || proof) && !changed.length);
    checks.push({ name: "live:recorded-agent-evidence", category: "live", status: ok ? "PASS" : "FAIL", detail: ok ? `Source-bound actual ${report!.model} provider report from ${report!.ranAt}; no additional provider calls.` : `Verified current-source live evidence required; changed sources: ${changed.join(", ") || "none"}` });
    if (!ok) finish("FAIL", checks);
    continue;
  }
  if (!pkg.scripts[script]) { checks.push({ name: `live:${script}`, category: "live", status: "FAIL", detail: "script missing" }); finish("FAIL", checks); }
  run(`live:${script}`, "live", ["npm", "run", script]);
}
if (!phases.some(id => MANIFESTS[id].live)) checks.push({ name: "live", category: "live", status: "NOT_RUN", detail: "No live-provider checks before V06" });

finish("PASS", checks);

function probe(url: string): boolean {
  const result = spawnSync("curl", ["-s", "-m", "2", "-o", "/dev/null", "-w", "%{http_code}", `${url}/version`], { encoding: "utf8" });
  return result.stdout.trim() === "200";
}

/** Starts `convex dev` against the local deployment and resolves once the working tree is pushed (or rejected). */
function startLocalBackend(): Promise<{ ok: boolean; detail?: string; stop: () => void }> {
  return new Promise(resolve => {
    const child = spawn("npx", ["convex", "dev", "--typecheck", "disable", "--tail-logs", "disable"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
    let output = "";
    let settled = false;
    const stop = () => {
      try { process.kill(-child.pid!, "SIGTERM"); } catch { /* already stopped */ }
      // The backend binary can outlive the CLI; make sure port 3210 is released.
      for (let attempt = 0; attempt < 20; attempt++) {
        const listener = spawnSync("lsof", ["-tiTCP:3210", "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim();
        if (!listener) return;
        for (const pid of listener.split("\n")) {
          const command = spawnSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" }).stdout;
          if (command.includes("convex-local-backend")) try { process.kill(Number(pid), "SIGTERM"); } catch { /* gone */ }
        }
        spawnSync("sleep", ["0.5"]);
      }
    };
    const settle = (ok: boolean, detail?: string) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ok, detail, stop }); };
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (/Convex functions ready!/.test(output)) settle(true);
      else if (/✖|Error:|error:/.test(output)) settle(false, output.split("\n").filter(line => /✖|rror/.test(line)).slice(0, 5).join(" | ").slice(0, 600));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", code => settle(false, `convex dev exited (${code})`));
    const timer = setTimeout(() => settle(false, "Timed out waiting for the local Convex push"), 180_000);
  });
}

function readEnvLocal(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env.local")) return undefined;
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}\\s*=\\s*["']?([^\\s"'#]+)`, "m"));
  return match?.[1];
}

// Rebuilds the demo baseline on the configured (local) Convex deployment. Usage: npm run demo:prepare [-- --no-agent]
// With the agent, Kestrel and Halden Star are replayed by the real agent (BREAKWATER_AGENT=live on the deployment);
// this script waits for the clock to go idle, then parks it at the baseline and stores the snapshot.
import { spawnSync } from "node:child_process";

const withAgent = !process.argv.includes("--no-agent");
const TIMEOUT_MS = 45 * 60_000;

function convexRun(fn: string, args: Record<string, unknown>, quiet = false): unknown {
  const result = spawnSync("npx", ["convex", "run", fn, JSON.stringify(args)], { encoding: "utf8", stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) { process.stderr.write(result.stderr ?? ""); process.exit(result.status ?? 1); }
  const out = result.stdout.trim();
  try { return JSON.parse(out); } catch { return out; }
}

if (!withAgent) {
  console.log(JSON.stringify(convexRun("demo:prepare", { withAgent: false }), null, 2));
  process.exit(0);
}

console.log("prepare: wipe + import, then replay Kestrel and Halden Star with the agent…");
console.log(JSON.stringify(convexRun("demo:prepareStart", { withAgent: true })));
const deadline = Date.now() + TIMEOUT_MS;
let last = "";
for (;;) {
  const status = convexRun("demo:prepareStatus", {}, true) as { clockStatus: string; simNow: number; tasks: Record<string, number>; cases: { code: string; statusLine: string }[] };
  const line = `${new Date(status.simNow).toISOString().slice(0, 16)} clock ${status.clockStatus} · tasks ${JSON.stringify(status.tasks)} · ${status.cases.map(item => `${item.code} ${item.statusLine}`).join(" | ")}`;
  if (line !== last) { console.log(line); last = line; }
  if (status.clockStatus === "IDLE") {
    if ((status.tasks.FAILED ?? 0) || (status.tasks.NEEDS_REVIEW ?? 0) || (status.tasks.RUNNING ?? 0) || (status.tasks.QUEUED ?? 0)) {
      console.error("prepare has unfinished or failed agent work; the baseline was NOT stored");
      process.exit(1);
    }
    break;
  }
  if (Date.now() > deadline) { console.error("prepare timed out; the baseline was NOT stored"); process.exit(1); }
  await new Promise(resolve => setTimeout(resolve, 3000));
}
console.log(JSON.stringify(convexRun("demo:prepareFinish", { requireComplete: true }), null, 2));

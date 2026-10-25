// Uploads fixtures/documents/**/*.pdf to the configured Convex deployment and registers them (idempotent).
// Usage: npm run documents:import  (local deployment; requires `npx convex dev` running)
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

type Entry = { ns: string; code: string; file: string };
const manifest = JSON.parse(readFileSync("fixtures/documents/manifest.json", "utf8")) as Entry[];

function run<T>(fn: string, args: unknown): T {
  const result = spawnSync("npx", ["convex", "run", fn, JSON.stringify(args)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`convex run ${fn} failed: ${result.stderr.slice(0, 400)}`);
  return JSON.parse(result.stdout) as T;
}

for (const ns of ["demo", "score"]) {
  const pending = run<string[]>("world/importDocuments:pending", { ns });
  if (!pending.length) { console.log(`${ns}: nothing to import`); continue; }
  let total = 0;
  for (let start = 0; start < pending.length; start += 25) {
    const codes = pending.slice(start, start + 25);
    const urls = run<string[]>("world/importDocuments:uploadUrls", { count: codes.length });
    const items = [];
    for (let index = 0; index < codes.length; index++) {
      const entry = manifest.find(item => item.ns === ns && item.code === codes[index])!;
      const response = await fetch(urls[index], { method: "POST", headers: { "Content-Type": "application/pdf" }, body: readFileSync(entry.file) });
      if (!response.ok) throw new Error(`upload failed for ${entry.code}: ${response.status}`);
      const { storageId } = (await response.json()) as { storageId: string };
      items.push({ code: entry.code, storageId });
    }
    total += run<number>("world/importDocuments:register", { ns, items });
  }
  console.log(`${ns}: registered ${total} documents`);
}

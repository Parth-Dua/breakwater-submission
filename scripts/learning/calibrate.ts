import { spawnSync } from "node:child_process";
const result = spawnSync("npx", ["convex", "run", "node/classifier/calibrate:run", JSON.stringify({})], { stdio: "inherit" });
process.exit(result.status ?? 1);

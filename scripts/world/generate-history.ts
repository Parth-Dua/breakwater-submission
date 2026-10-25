// Writes fixtures/world/history.json (WORLD §7). Deterministic: same seed → identical bytes.
import { writeFileSync } from "node:fs";
import { generateHistory, HISTORY_SEED } from "../../src/world/history";

const cases = generateHistory(HISTORY_SEED);
writeFileSync("fixtures/world/history.json", JSON.stringify({ seed: HISTORY_SEED, cases }) + "\n");
console.log(`history: ${cases.length} cases, ${cases.reduce((n, c) => n + c.ais.length, 0)} AIS points, ${cases.reduce((n, c) => n + c.journals.length, 0)} journals`);

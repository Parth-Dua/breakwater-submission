// Writes fixtures/world/scoreboard.json (WORLD §8). Deterministic: same seed → identical bytes.
import { writeFileSync } from "node:fs";
import { generateScoreboard, SCORE_SEED } from "../../src/world/scoreboard";

const voyages = generateScoreboard(SCORE_SEED);
writeFileSync("fixtures/world/scoreboard.json", JSON.stringify({ seed: SCORE_SEED, voyages }) + "\n");
console.log(`scoreboard: ${voyages.length} voyages, plants ${voyages.reduce((n, v) => n + v.plants.length, 0)}, asks ${voyages.reduce((n, v) => n + v.answerKey.expectedAsks.length, 0)}`);

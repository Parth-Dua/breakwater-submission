import { defineConfig } from "vitest/config";

// Live provider checks (real Claude). Never part of `npm test`; run by the phase gate as `npm run test:live`.
export default defineConfig({
  test: { include: ["scripts/live/**/*.ts"], environment: "node", server: { deps: { inline: ["convex-test"] } }, testTimeout: 120 * 60_000, hookTimeout: 120_000 },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});

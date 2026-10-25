import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/v2/**/*.test.ts"], environment: "node", server: { deps: { inline: ["convex-test"] } } },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});

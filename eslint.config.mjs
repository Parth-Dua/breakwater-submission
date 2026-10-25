import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([".next/**", "public/vendor/**", ".tools/**", "artifacts/**", "out/**", "dist/**", "coverage/**", "convex/_generated/**", "playwright-report/**", "test-results/**", "archive/**", "tests/v1-archive/**", "scripts/v1-archive/**"]),
]);

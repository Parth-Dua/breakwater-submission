import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// v2 E2E runs against a production build of the frontend and the local Convex deployment (MIGRATION §4).
export default defineConfig({
  testDir: "./tests/v2/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "off",
    viewport: { width: 1440, height: 900 },
    launchOptions: existsSync(systemChrome) ? { executablePath: systemChrome } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: "npm run start -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

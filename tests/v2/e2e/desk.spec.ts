import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("acting-as")).toBeEnabled();
  await expect(page.locator('[data-case="DC-2026-0398"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
function restoreBaseline() {
  const result = spawnSync("npx", ["convex", "run", "demo:restore", JSON.stringify({ label: "baseline", actor: "system:AUTOMATED_TEST:V07" })], { encoding: "utf8" });
  expect(result.status, result.stderr.slice(-1000)).toBe(0);
}

test("V07 baseline: Kestrel Ops ask, Halden recovery, 32 closed; distinct metrics may have equal values", async ({ page }) => {
  await ready(page);
  await expect(page.locator('[data-case="DC-2026-0398"]')).toContainText("Waiting · Ops");
  await expect(page.locator('[data-case="DC-2026-0405"]')).toContainText("Recovery filed");
  await expect(page.getByRole("button", { name: "32 closed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Answer as Ops" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New disruption" })).toBeEnabled();
  const metrics = await page.locator("[data-money-metric]:visible").evaluateAll(elements => elements.map(element => element.getAttribute("data-money-metric")));
  expect(new Set(metrics).size).toBe(metrics.length);
  await expect(page.locator('[data-money-metric="desk:1"]')).toHaveText("$27,000");
  await expect(page.locator('[data-money-metric="case:DC-2026-0405:recover"]')).toHaveText("$27,000");
  await expect(page.getByText("$9,000", { exact: true })).toHaveCount(1);
});

test("V07 Books: actual balanced trial balance, quarter/all filters and journal evidence", async ({ page }) => {
  await ready(page); await page.getByRole("tab", { name: "Books", exact: true }).click();
  await expect(page.getByTestId("trial-balance-status")).toHaveText("Balanced");
  const journals = page.getByRole("region", { name: "Journals", exact: true });
  await expect(journals.getByRole("button", { expanded: false })).toHaveCount(1);
  await journals.getByRole("button", { expanded: false }).click();
  await expect(journals.getByText("Dr", { exact: true })).toBeVisible();
  await expect(journals.getByText("Cr", { exact: true })).toBeVisible();
  await expect(journals.getByText("Clause laytime", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect.poll(async () => journals.getByRole("button", { expanded: false }).count()).toBeGreaterThan(100);
  await page.getByRole("button", { name: "This quarter", exact: true }).click();
  await expect(journals.getByRole("button", { expanded: false })).toHaveCount(0);
});

test("V07 Answer as flow switches the server persona before navigating", async ({ page }) => {
  await ready(page); await page.getByRole("button", { name: "Answer as Ops" }).click();
  await expect(page).toHaveURL(/\/case\/DC-2026-0398$/);
  await expect(page.getByTestId("acting-as")).toHaveValue("OPS");
  await page.reload(); await expect(page.getByTestId("acting-as")).toBeEnabled();
  await expect(page.getByTestId("acting-as")).toHaveValue("OPS");
});

test("V07 screenshots U-01/U-02: Cases, Books, Proof at supported desktop sizes", async ({ page }) => {
  mkdirSync("artifacts/v2/V07", { recursive: true });
  for (const [width, height] of [[1440, 900], [1280, 800]] as const) {
    await page.setViewportSize({ width, height }); await ready(page);
    for (const tab of ["Cases", "Books", "Proof"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("data-state", "active");
      if (tab === "Books") await expect(page.getByTestId("trial-balance-status")).toHaveText("Balanced");
      if (tab === "Proof") await expect(page.getByRole("heading", { name: "Scoreboard" })).toBeVisible();
      await page.screenshot({ animations: "disabled", path: `artifacts/v2/V07/${tab.toLowerCase()}-${width}x${height}.png` });
      const geometry = await page.evaluate(() => ({ width: document.scrollingElement!.scrollWidth, height: document.scrollingElement!.scrollHeight, viewportWidth: innerWidth, viewportHeight: innerHeight }));
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight);
    }
  }
});

test("V07 narrow screens provide a stacked read-only Desk", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto("/");
  await expect(page.locator('[data-case="DC-2026-0398"]')).toBeVisible();
  await expect(page.getByTestId("acting-as")).toBeDisabled();
  await expect(page.getByRole("button", { name: "New disruption" })).toHaveCount(0);
  const geometry = await page.evaluate(() => ({ width: document.scrollingElement!.scrollWidth, viewport: innerWidth }));
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  await page.screenshot({ animations: "disabled", path: "artifacts/v2/V07/cases-375x812-readonly.png" });
});

test("U-14 live: disruption opens a working row within 5s and updates its status without a reload", async ({ page }) => {
  test.skip(Number(process.env.BREAKWATER_GATE_PHASE?.slice(1) ?? 0) >= 9, "Covered in the integrated V09 live scenario to conserve provider credits");
  test.setTimeout(90_000);
  await ready(page);
  await page.evaluate(() => { (window as Window & { deskVisit?: string }).deskVisit = "V07-live-check"; });
  try {
    await page.getByRole("button", { name: "New disruption" }).click();
    const row = page.locator('[data-vessel="Aster Vale"]');
    await expect(row).toBeVisible({ timeout: 5_000 });
    await expect(row).toHaveAttribute("aria-busy", "true");
    const first = await row.getByTestId("case-status").innerText();
    await expect.poll(async () => row.getByTestId("case-status").innerText(), { timeout: 20_000 }).not.toBe(first);
    await expect(row).toHaveAttribute("data-case", "DC-2026-0412", { timeout: 20_000 });
    expect(await page.evaluate(() => (window as Window & { deskVisit?: string }).deskVisit)).toBe("V07-live-check");
    await expect(page.getByRole("button", { name: "New disruption" })).toBeDisabled();
    writeFileSync("artifacts/v2/V07/live-disruption.json", JSON.stringify({ origin: "AUTOMATED_TEST", humanEvidence: false, realProvider: true, caseOpened: true, subscriptionUpdated: true, checkedAt: new Date().toISOString() }, null, 2));
  } finally {
    // Restore the already-prepared baseline; never rerun completed prepare/asks/postings.
    restoreBaseline();
  }
});

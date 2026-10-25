import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { signInAs } from "../helpers/sign-in";
test("all route shells render and navigation identifies the active route", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await signInAs(page,"auditor");
  const routes = [["/overview", "Overview"], ["/claims", "Claims"], ["/claims/V-203", "Claim V-203"], ["/work", "Work Queue"], ["/work/W-001", "Review W-001"], ["/memory", "Institutional Memory"], ["/memory/P-009", "Memory P-009"], ["/ledger", "Ledger"], ["/audit", "Audit Trail"], ["/scenarios", "Scenario Controls"]];
  for (const [route, title] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  }
  await page.getByRole("navigation").getByRole("link", { name: "Claims", exact: true }).click();
  await expect(page).toHaveURL(/\/claims$/);
  await expect(page.getByRole("navigation").getByRole("link", { name: "Claims", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Scenario Controls" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("desktop and mobile layouts remain usable with keyboard navigation", async ({ page }) => {
  mkdirSync("artifacts/phase-01", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInAs(page,"auditor");
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Unresolved", exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/phase-01/overview-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Claims", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Claims", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.goto("/overview");
  await expect(page.getByRole("columnheader", { name: "Unresolved", exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/phase-01/overview-mobile.png", fullPage: true });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});

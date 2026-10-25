import { expect, test } from "@playwright/test";
import { signInAs } from "../helpers/sign-in";
test("authenticated reader sees the persisted live-provider trace and Operations handoff", async ({ page }) => {
  await signInAs(page, "auditor"); await page.goto("/claims/CL-203");
  const trace = page.locator(".investigation-trace");
  await expect(trace.locator(".agent-run").first()).toBeVisible({ timeout: 30_000 });
  await expect(trace).toContainText("Live provider: claude-");
  await expect(trace).toContainText("get_claim_snapshot");
  await expect(trace.getByRole("link", { name: "Open Operations question →", exact: true })).toBeVisible();
  await expect(trace.getByRole("button", { name: "Investigate claim", exact: true })).toHaveCount(0);
  await trace.locator(".tool-outcome").filter({ hasText: "get_claim_snapshot" }).first().locator("summary").click();
  await expect(trace.locator("pre").first()).toContainText('"unverifiedCents":2000000');
});

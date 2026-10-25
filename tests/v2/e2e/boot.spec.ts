import { expect, test } from "@playwright/test";

test("app loads without sign-in and the persona toggle persists server-side", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Breakwater", { exact: true })).toBeVisible();
  const toggle = page.getByTestId("acting-as");
  await expect(toggle).toBeEnabled(); // anonymous sign-in completed
  await expect(toggle).toHaveValue("OBSERVER");
  await toggle.selectOption("CONTROLLER");
  await expect(toggle).toHaveValue("CONTROLLER");
  await page.reload();
  await expect(page.getByTestId("acting-as")).toBeEnabled();
  await expect(page.getByTestId("acting-as")).toHaveValue("CONTROLLER"); // came back from the server session
  await page.getByTestId("acting-as").selectOption("OBSERVER");
  await expect(page.getByTestId("acting-as")).toHaveValue("OBSERVER");
});

test("retired v1 routes redirect to the Desk", async ({ page }) => {
  for (const route of ["/overview", "/claims/CL-203", "/work", "/memory", "/ledger", "/audit", "/scenarios", "/sign-in"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/127\.0\.0\.1:3000\/$/);
  }
});

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BANNED = [/AI-powered/i, /\bintelligent\b/i, /\bseamless/i, /\bleverag/i, /\brobust\b/i, /\bmagic/i, /\bsimply\b/i, /please note/i, /as an AI/i, /\bworkflow/i, /lorem ipsum/i, /\bsynthetic\b/i, /\bsimulat(ed|ion)\b/i, /\bfixture/i, /\bmock/i];
const ROUTES = [{ name: "desk", path: "/" }, { name: "room", path: "/case/DC-2026-0412" }];

async function settle(page: Page) {
  await expect(page.getByTestId("acting-as")).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
}

for (const route of ROUTES) {
  test(`U-11 no page scroll at 1440×900: ${route.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route.path);
    await settle(page);
    const { scrollHeight, clientHeight, scrollWidth, clientWidth } = await page.evaluate(() => {
      const el = document.scrollingElement!;
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test(`U-12 one SIM badge, no banned copy: ${route.name}`, async ({ page }) => {
    await page.goto(route.path);
    await settle(page);
    await expect(page.getByText("SIM", { exact: true })).toHaveCount(1);
    const text = await page.locator("body").innerText();
    for (const pattern of BANNED) expect(text, `banned ${pattern}`).not.toMatch(pattern);
    expect(text).not.toMatch(/\bdemo\b/i);
  });

  test(`screenshots: ${route.name}`, async ({ page }) => {
    mkdirSync("artifacts/v2/V01", { recursive: true });
    for (const [width, height] of [[1440, 900], [1280, 800]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(route.path);
      await settle(page);
      await page.screenshot({ path: `artifacts/v2/V01/${route.name}-${width}x${height}.png` });
    }
  });
}

test("grid geometry matches UI §4/§5", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await settle(page);
  const header = await page.locator("header").boundingBox();
  expect(header?.height).toBe(56);
  await page.goto("/case/DC-2026-0412");
  await settle(page);
  const rail = await page.locator('[data-region="rail"]').boundingBox();
  const timeline = await page.locator('[data-region="timeline"]').boundingBox();
  const money = await page.locator('[data-region="money"]').boundingBox();
  expect(Math.round(rail!.width)).toBe(400);
  expect(Math.round(timeline!.height)).toBe(168);
  expect(Math.round(money!.height)).toBe(64);
});

test("Room keyboard order follows UI §11: stage → timeline → rail → money", async ({ page }) => {
  await page.goto("/case/DC-2026-0412");
  await settle(page);
  const order = await page.evaluate(() => Array.from(document.querySelectorAll("[data-region]")).map(el => el.getAttribute("data-region")));
  expect(order).toEqual(["stage", "timeline", "rail", "money"]);
});

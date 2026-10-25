import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function convex(name: string, args: object) {
  const result = spawnSync("npx", ["convex", "run", name, JSON.stringify(args)], { encoding: "utf8" });
  expect(result.status, result.stderr.slice(-1000)).toBe(0);
  return JSON.parse(result.stdout.trim() || "null");
}
async function room(page: Page, code = "DC-2026-0398") {
  mkdirSync("artifacts/v2/V08", { recursive: true });
  // Exercise the bundled coastline even when external tiles are unavailable.
  await page.route("https://tiles.openfreemap.org/**", route => route.abort());
  await page.goto(`/case/${code}`);
  await expect(page.getByTestId("acting-as")).toBeEnabled();
  await page.getByTestId("acting-as").selectOption("OBSERVER");
  await expect(page.getByTestId("room-stage")).toHaveAttribute("data-mode", "MAP");
  await expect(page.getByRole("img", { name: "Vessel position" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test("V08 U-13/U-15: one metric per identity; only the center work surface changes by role", async ({ page }) => {
  await room(page);
  const stable = async () => Promise.all(["case-timeline", "thinking-feed", "room-money"].map(id => page.getByTestId(id).innerText()));
  const before = await stable();
  const metrics = await page.locator("[data-money-metric]:visible").evaluateAll(elements => elements.map(el => el.getAttribute("data-money-metric")));
  expect(new Set(metrics).size).toBe(metrics.length);
  await expect(page.locator('[data-money-metric="room:DC-2026-0398:PAYABLE"]')).toHaveText("$36,000");
  await page.getByTestId("acting-as").selectOption("OPS");
  await expect(page.getByTestId("room-stage")).toHaveAttribute("data-mode", "OPS_DESK");
  expect(await stable()).toEqual(before);
  await page.getByTestId("acting-as").selectOption("CONTROLLER");
  await expect(page.getByTestId("room-stage")).toHaveAttribute("data-mode", "MAP");
  expect(await stable()).toEqual(before);
});

test("V08 U-17: NOR pin opens actual PDF and highlights the recorded quote", async ({ page }) => {
  await room(page); await page.getByTestId("nor-pin").click();
  await expect(page.getByTestId("room-stage")).toHaveAttribute("data-mode", "DOCUMENT");
  await expect(page.getByTestId("document-viewer")).toHaveAttribute("data-document", "DOC-NOR-KESTREL");
  await expect(page.locator('[data-quote-highlight="true"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page" })).toBeVisible();
  await page.screenshot({ path: "artifacts/v2/V08/nor-quote.png" });
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByTestId("room-stage")).toHaveAttribute("data-mode", "MAP");
  await page.getByRole("button", { name: /Open.*statement of facts/i }).first().click();
  await expect(page.getByTestId("document-viewer")).toHaveAttribute("data-document", "DOC-SOF-KESTREL");
});

test("V08 U-18/U-19: cursor keyboard, no future path, Live and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await room(page);
  const timeline = page.getByTestId("case-timeline"), map = page.getByTestId("vessel-map");
  const live = Number(await timeline.getAttribute("data-view-at"));
  await timeline.focus(); await page.keyboard.press("ArrowLeft");
  await expect(timeline).toHaveAttribute("data-view-at", String(live - 3_600_000));
  await expect(map).toHaveAttribute("data-view-at", String(live - 3_600_000));
  expect(Number(await map.getAttribute("data-track-end"))).toBeLessThanOrEqual(live - 3_600_000);
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(timeline).toHaveAttribute("data-view-at", String(live - 7 * 3_600_000));
  await page.keyboard.press("Escape"); await expect(timeline).toHaveAttribute("data-view-at", String(live));
  await expect(page.getByRole("button", { name: "Live", exact: true })).toHaveAttribute("aria-pressed", "true");
  const duration = await page.getByTestId("thinking-feed").locator("li").first().evaluate(el => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThanOrEqual(.01);
});

test("V08 Why templates, actual journal lines, memory and desktop screenshots", async ({ page }) => {
  mkdirSync("artifacts/v2/V08", { recursive: true }); await room(page, "DC-2026-0405");
  await page.getByRole("button", { name: "Why recover?" }).click();
  if (Number(process.env.BREAKWATER_GATE_PHASE?.slice(1) ?? 0) >= 11) {
    await expect.poll(() => convex("explain:evidence", { entityId: "DC-2026-0405", field: "RECOVERABLE" }).length, { timeout: 100_000 }).toBeGreaterThan(0);
    const cached = convex("explain:evidence", { entityId: "DC-2026-0405", field: "RECOVERABLE" }).at(-1);
    await expect(page.getByText(cached.text, { exact: true })).toBeVisible();
  } else await expect(page.getByText("The recovery is the recorded claim filed under its recorded authority.", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Journals", exact: true }).click();
  await expect(page.getByText("Dr 1200", { exact: true })).toBeVisible();
  await expect(page.getByText("Cr 5190", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  await expect(page.getByText("Recent", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Thinking", exact: true }).click();
  for (const [width, height] of [[1440, 900], [1280, 800]] as const) {
    await page.setViewportSize({ width, height });
    await room(page, "DC-2026-0405");
    await page.screenshot({ animations: "disabled", path: `artifacts/v2/V08/room-${width}x${height}.png` });
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth && document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
  }
});

test("V08 U-03 live: Aster prefix publishes NOW/done steps, physical track and NOR distance", async ({ page }) => {
  test.skip(Number(process.env.BREAKWATER_GATE_PHASE?.slice(1) ?? 0) >= 9, "Covered in the integrated V09 live scenario to conserve provider credits");
  test.setTimeout(150_000); mkdirSync("artifacts/v2/V08", { recursive: true });
  try {
    await page.route("https://tiles.openfreemap.org/**", route => route.abort());
    convex("sim:runUntil", { ns: "demo", scripts: ["RTM-STORM-2026-10"], until: Date.UTC(2026, 9, 25) });
    await page.goto("/case/DC-2026-0412");
    await expect(page.getByTestId("acting-as")).toBeEnabled(); await page.getByTestId("acting-as").selectOption("OBSERVER");
    await expect(page.getByTestId("now-card")).toBeVisible({ timeout: 45_000 });
    const first = await page.getByTestId("now-card").innerText();
    await expect.poll(async () => page.getByTestId("thinking-feed").locator("li").count(), { timeout: 90_000 }).toBeGreaterThan(3);
    await expect(page.getByTestId("nor-distance")).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => convex("demo:prepareStatus", {}).clockStatus, { timeout: 90_000, intervals: [3000] }).toBe("IDLE");
    await expect(page.getByRole("img", { name: "Vessel position" })).toBeVisible();
    const distance = await page.getByTestId("nor-distance").innerText(); expect(distance).toMatch(/[\d.]+ nm/);
    for (const [width, height] of [[1440, 900], [1280, 800]] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.screenshot({ path: `artifacts/v2/V08/live-aster-${width}x${height}.png` });
    }
    writeFileSync("artifacts/v2/V08/live-room.json", JSON.stringify({ origin: "AUTOMATED_TEST", humanEvidence: false, realProvider: true, initialNow: first, distance, prefixOnly: true, checkedAt: new Date().toISOString() }, null, 2));
  } finally { convex("demo:restore", { label: "baseline", actor: "system:AUTOMATED_TEST:V08" }); }
});

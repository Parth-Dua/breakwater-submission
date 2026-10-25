import { expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { signInAs } from "../helpers/sign-in";
function cloud<T>(name: string, args: object): T {
  const result = spawnSync("node_modules/.bin/convex", ["run", name, JSON.stringify(args)], { encoding: "utf8", timeout: 45_000 });
  if (result.status !== 0) throw new Error("Isolated automation setup/inspection failed; raw output suppressed");
  return JSON.parse(result.stdout) as T;
}
async function range(page: Page, label: string, at: number) {
  await page.getByRole("slider", { name: label, exact: true }).evaluate((element, at) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, String(at)); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); }, at);
}
test("ordinary Operations UI captures an explicitly automated source-backed review and resumes the agent", async ({ page }) => {
  test.setTimeout(300_000);
  const scenarioCode = `breakwater-demo-ui${randomUUID().replaceAll("-", "")}`, fixture = cloud<{ workItemId: string; claimId: string }>("internal/automation:prepare", { scenarioCode, claimCode: "CL-203" });
  await page.setViewportSize({ width: 1500, height: 1100 }); await signInAs(page, "automation_operations"); await page.goto("/work");
  await page.getByRole("link", { name: "Review delay cause — V-203", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review delay cause — V-203", exact: true })).toBeVisible();
  await expect(page.locator(".review-question")).toContainText("48 hours"); await page.getByRole("button", { name: "Start review", exact: true }).click();
  await expect(page.locator(".capture-label")).toContainText("Automated test session");
  await page.getByLabel("Search this voyage’s archive").fill("customs"); await page.getByRole("button", { name: "Search archive", exact: true }).click();
  await page.getByRole("button", { name: "Open OPS-V-203", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("customs clearance caused");
  await page.getByRole("button", { name: "Compare with missing interval", exact: true }).click(); await expect(page.locator(".comparison-result")).toContainText("2880 of 2880 requested minutes covered");
  await page.getByRole("button", { name: "Link evidence to review", exact: true }).click(); await expect(page.getByRole("dialog").getByRole("button", { name: "Linked for review", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close archive source", exact: true }).click();
  await expect(page.locator(".exposure-total")).toContainText("$20,000");
  const slider = page.getByRole("slider", { name: "Timeline playhead", exact: true }), start = Number(await slider.getAttribute("min")) + 6 * 3_600_000;
  const beforePlayback = cloud<string>("internal/automation:inspect", { workItemId: fixture.workItemId });
  await page.getByRole("button", { name: "Play voyage", exact: true }).click(); await page.waitForTimeout(400); await page.getByRole("button", { name: "Pause voyage", exact: true }).click();
  expect(JSON.parse(cloud<string>("internal/automation:inspect", { workItemId: fixture.workItemId })).history[0].events.length).toBe(JSON.parse(beforePlayback).history[0].events.length);
  await page.getByText("Select time range", { exact: true }).click(); await range(page, "Range start", start + 24 * 3_600_000); await range(page, "Range end", start + 72 * 3_600_000);
  await expect(page.getByTestId("selection-summary")).toContainText("2880 claimed minutes");
  await page.getByLabel("Operational cause", { exact: true }).selectOption("CUSTOMS"); await page.getByRole("checkbox", { name: "OPS-V-203", exact: true }).check();
  await page.getByLabel("Finding note or clarification question", { exact: true }).fill("Signed Operations log OPS-V-203 confirms customs clearance across the requested 48 hours.");
  await page.getByRole("button", { name: "Save finding draft", exact: true }).click(); await expect(page.getByText("Draft saved. It has not been submitted as a final finding.", { exact: true })).toBeVisible();
  await page.getByLabel("Finding note or clarification question", { exact: true }).fill("Correction: verified voyage and interval against signed OPS-V-203. Customs clearance covers all 2880 requested minutes; AIS supplies location context only.");
  await page.getByRole("button", { name: "Save correction", exact: true }).click(); await expect(page.getByText("Draft saved. It has not been submitted as a final finding.", { exact: true })).toBeVisible();
  mkdirSync("artifacts/phase-06", { recursive: true }); await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); scrollTo(0, 0); }); await page.screenshot({ path: "artifacts/phase-06/review-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.getByRole("heading", { name: "Review delay cause — V-203", exact: true })).toHaveCount(1);
  // The WebGL compositor can repeat tiles in very tall (>4096px) mobile full-page captures.
  // Inspect actual viewport captures at the top, form and map instead.
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: "artifacts/phase-06/review-mobile.png" });
  await page.locator(".finding-panel").scrollIntoViewIfNeeded(); await expect(page.getByRole("button", { name: "Submit finding", exact: true })).toBeVisible(); await page.screenshot({ path: "artifacts/phase-06/review-mobile-finding.png" });
  await page.getByTestId("trajectory-map").scrollIntoViewIfNeeded(); await expect(page.getByTestId("trajectory-map")).toHaveAttribute("data-loaded", "true"); await page.screenshot({ path: "artifacts/phase-06/review-mobile-timeline.png" });
  await page.getByRole("button", { name: "Submit finding", exact: true }).click(); await expect(page.getByRole("heading", { name: "Finding submitted · CUSTOMS", exact: true })).toBeVisible();
  await expect(page.locator(".figure-unverified")).toContainText("$0"); await expect(page.locator(".figure-disputed")).toContainText("$20,000");
  await expect(page.locator(".agent-run").first()).toContainText("WAITING EXTERNAL", { timeout: 180_000 }); await expect(page.locator(".agent-run").first()).toContainText("Live provider: claude-");
  const report = JSON.parse(cloud<string>("internal/automation:inspect", { workItemId: fixture.workItemId })) as { workStatus: string; history: { captureOrigin: string; actorId: string; status: string; events: { eventType: string; actorId: string; actorRole: string; sequence: number; at: number }[] }[] };
  expect(report.workStatus).toBe("SUBMITTED"); expect(report.history).toHaveLength(1); const session = report.history[0]; expect(session.captureOrigin).toBe("AUTOMATED_TEST"); expect(session.status).toBe("COMPLETED");
  const types = session.events.map(event => event.eventType); for (const type of ["WORK_SESSION_STARTED", "ARCHIVE_SEARCHED", "EVIDENCE_OPENED", "EVIDENCE_COMPARED", "EVIDENCE_LINKED", "TIMELINE_RANGE_SELECTED", "FINDING_EDITED", "DECISION_CORRECTED", "FINDING_SUBMITTED", "WORK_SESSION_COMPLETED"]) expect(types).toContain(type);
  expect(session.events.every((event, index) => event.actorId === session.actorId && event.actorRole === "operations_reviewer" && event.sequence === index && Number.isSafeInteger(event.at))).toBe(true);
  writeFileSync("artifacts/phase-06/automated-sequence.json", JSON.stringify({ scenarioCode, ...report, evidenceKind: "Actual automated browser interactions; not human-learning proof" }, null, 2));
});

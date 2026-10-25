import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function convex(name: string, args: object) {
  const result = spawnSync("npx", ["convex", "run", name, JSON.stringify(args)], { encoding: "utf8" });
  expect(result.status, result.stderr.slice(-1000)).toBe(0); return JSON.parse(result.stdout.trim() || "null");
}
function restore() { convex("demo:restore", { label: "baseline", actor: "system:AUTOMATED_TEST:V09" }); }
async function ops(page: Page) {
  await page.goto("/case/DC-2026-0398"); await expect(page.getByTestId("acting-as")).toBeEnabled(); await page.getByTestId("acting-as").selectOption("OPS");
  await expect(page.getByTestId("ops-desk")).toBeVisible();
  await page.getByRole("button", { name: "Customs portal", exact: true }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByTestId("ops-desk").getByRole("button", { name: /Customs release 1004/ }).click();
  await expect(page.getByTestId("document-viewer")).toBeVisible();
  await page.getByRole("button", { name: "Link to hold", exact: true }).click();
  await expect(page.getByRole("button", { name: "Linked", exact: true })).toBeDisabled();
}

test("V09 static U-16: source search → real PDF → link/unlink are semantic, ordered and labeled", async ({ page }) => {
  mkdirSync("artifacts/v2/V09", { recursive: true }); restore(); const since = Date.now();
  try {
    await ops(page);
    await page.getByRole("button", { name: /Unlink/ }).click();
    await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Link to hold", exact: true })).toBeEnabled();
    const events = convex("work:evidence", { since }).events;
    expect(events.map((event: { type: string }) => event.type)).toEqual(["WORK_STARTED", "SOURCE_SEARCHED", "DOCUMENT_OPENED", "EVIDENCE_LINKED", "EVIDENCE_UNLINKED"]);
    expect(events.every((event: { origin: string }) => event.origin === "AUTOMATED_TEST")).toBe(true);
    await page.screenshot({ animations: "disabled", path: "artifacts/v2/V09/ops-sources.png" });
    await page.getByTestId("acting-as").selectOption("TRADER");
    await expect(page.getByTestId("ops-desk")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
  } finally { restore(); }
});

const acceptedSources = ["convex/lib/validators.ts", "convex/asks.ts", "convex/gateway.ts", "convex/node/documents.ts", "src/documents/letters.ts", "convex/sources/humanSearch.ts", "convex/sources.ts", "convex/human.ts", "convex/statements.ts", "convex/work.ts", "convex/filingDocuments.ts", "src/features/work/OpsDesk.tsx", "src/features/work/StatementEditor.tsx", "src/features/work/RecoveryDecision.tsx", "src/features/work/TeachBackCard.tsx", "src/features/work/useWork.ts", "src/features/room/Room.tsx", "src/features/room/Map.tsx"];

test("V09 live: real Ops answer, integrated U-14/U-03, Trader partial and Controller edit post verified journals", async ({ page }) => {
  test.skip(Number(process.env.BREAKWATER_GATE_PHASE?.slice(1) ?? 0) >= 10, "Covered by the V10 real learned-procedure scenario; avoids a duplicate provider run");
  test.setTimeout(600_000); mkdirSync("artifacts/v2/V09", { recursive: true }); restore();
  const since = Date.now(); let opsEvidence;
  try {
    await page.route("https://tiles.openfreemap.org/**", route => route.abort());
    await ops(page); await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page.getByTestId("acting-as")).toHaveValue("OBSERVER");
    await expect(page.getByTestId("room-stage")).toHaveAttribute("data-mode", "MAP");
    await expect(page.locator('[data-money-metric="room:DC-2026-0398:RECOVERABLE"]')).toHaveText("$27,000", { timeout: 90_000 });
    await expect.poll(() => convex("room:money", { caseCode: "DC-2026-0398" }).recoveryState, { timeout: 90_000 }).toBe("filed");
    await expect.poll(() => convex("work:evidence", { since }).tasks.every((task: { state: string }) => ["SUCCEEDED", "WAITING_HUMAN"].includes(task.state)), { timeout: 90_000 }).toBe(true);
    opsEvidence = convex("work:evidence", { since });
    expect(opsEvidence.events.map((event: { type: string }) => event.type)).toEqual(["WORK_STARTED", "SOURCE_SEARCHED", "DOCUMENT_OPENED", "EVIDENCE_LINKED", "ANSWER_SUBMITTED"]);
    expect(opsEvidence.events.every((event: { origin: string }) => event.origin === "AUTOMATED_TEST")).toBe(true);
    // V09 isolates role work from V10 learning. Explicit test seed, never claimed as human learning.
    convex("demo:insertBatch", { table: "memoryItems", rows: [{ _id: "test-v09-procedure", ns: "demo", origin: "AUTOMATED_TEST", code: "test-v09-customs-procedure", kind: "PROCEDURE", status: "ACTIVE", title: "Customs portal capability (automated test seed)", payload: { type: "PROCEDURE", procedure: { dslVersion: 2, trigger: { intervalKind: "CUSTOMS_HOLD", missingEvidence: "CUSTOMS_RELEASE", ports: "ALL" }, grants: [{ system: "CUSTOMS_PORTAL", scope: "CASE_VESSEL_AND_INTERVAL" }], steps: [{ op: "SEARCH_SOURCE", system: "CUSTOMS_PORTAL", match: { vessel: true, interval: true } }, { op: "VERIFY_DOCUMENT", checks: ["SAME_VESSEL", "COVERS_INTERVAL"] }, { op: "MARK_VERIFIED" }, { op: "ESCALATE_IF_MISSING", role: "ops" }] } }, scope: { kind: "ALL" }, version: 1, usedIn: [], createdAt: Date.UTC(2026, 9, 24) }] });
    await page.goto("/"); await expect(page.getByRole("button", { name: "New disruption" })).toBeEnabled();
    await page.getByRole("button", { name: "New disruption" }).click();
    const row = page.locator('[data-vessel="Aster Vale"]'); await expect(row).toBeVisible({ timeout: 5_000 }); await expect(row).toHaveAttribute("aria-busy", "true");
    const first = await row.getByTestId("case-status").innerText();
    await expect.poll(() => row.getByTestId("case-status").innerText(), { timeout: 45_000 }).not.toBe(first);
    await expect(row).toHaveAttribute("data-case", "DC-2026-0412", { timeout: 45_000 });
    await page.goto("/case/DC-2026-0412");
    await expect(page.getByTestId("now-card")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("nor-distance")).toHaveText("24.0 nm", { timeout: 90_000 });
    await page.screenshot({ animations: "disabled", path: "artifacts/v2/V09/live-nor.png" });
    await expect(page.getByRole("button", { name: "Answer as Trader", exact: true })).toBeVisible({ timeout: 180_000 });
    await page.getByRole("button", { name: "Answer as Trader", exact: true }).click();
    await expect(page.getByTestId("recovery-decision")).toBeVisible();
    await page.getByRole("button", { name: "Partial", exact: true }).click();
    await page.getByRole("textbox", { name: "File amount", exact: true }).fill("90600");
    await page.getByRole("textbox", { name: "Reason", exact: true }).fill("Goodwill: Hansa took a late Q3 cargo");
    await page.screenshot({ animations: "disabled", path: "artifacts/v2/V09/trader-partial.png" });
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page.getByTestId("acting-as")).toHaveValue("OBSERVER");
    await expect.poll(() => convex("room:money", { caseCode: "DC-2026-0412" }).recoverCents, { timeout: 90_000 }).toBe(9_060_000);
    await expect(page.getByRole("button", { name: "Answer as Controller", exact: true })).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Answer as Controller", exact: true }).click();
    await expect(page.getByTestId("statement-editor")).toBeVisible();
    await page.getByRole("combobox", { name: "Treatment port closure", exact: true }).selectOption("COUNT");
    await page.getByRole("textbox", { name: "Basis note", exact: true }).fill("CP cl. 8 proviso: already on demurrage");
    await page.getByRole("button", { name: "Save edit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Approve $122,150", exact: true })).toBeEnabled();
    await page.screenshot({ animations: "disabled", path: "artifacts/v2/V09/controller-edit.png" });
    await page.getByRole("button", { name: "Approve $122,150", exact: true }).click();
    await expect(page.getByTestId("acting-as")).toHaveValue("OBSERVER");
    await expect.poll(() => convex("room:money", { caseCode: "DC-2026-0412" }).payableState, { timeout: 90_000 }).toBe("approved");
    await expect.poll(() => convex("work:evidence", { since }).clockStatus, { timeout: 90_000 }).toBe("IDLE");
    const money = convex("room:money", { caseCode: "DC-2026-0412" });
    expect(money).toMatchObject({ oweCents: 12_215_000, recoverCents: 9_060_000, netCents: -3_155_000 });
    const state = convex("work:evidence", { since });
    expect(state.tasks.every((task: { state: string }) => ["SUCCEEDED", "WAITING_HUMAN"].includes(task.state))).toBe(true);
    const kinds = ["AIS_UPDATE", "ASK_ANSWERED", "DEADLINE_CHECK", "DOCUMENT_RECEIVED", "FLEET_SCAN", "MONTH_END", "PORT_NOTICE"];
    expect(kinds.every(kind => state.tasks.some((task: { kind: string }) => task.kind === kind))).toBe(true);
    expect(state.tasks.every((task: { model: string }) => task.model === "claude-sonnet-5-5")).toBe(true);
    expect(state.events.every((event: { origin: string }) => event.origin === "AUTOMATED_TEST")).toBe(true);
    expect(state.asks.filter((ask: { caseCode: string }) => ask.caseCode === "DC-2026-0412").map((ask: { kind: string }) => ask.kind).sort()).toEqual(["COMMERCIAL_DECISION", "PAYMENT_APPROVAL"]);
    const journals = convex("books:journals", { filter: "ALL" }).filter((entry: { caseCode: string }) => entry.caseCode === "DC-2026-0412");
    expect(journals.find((entry: { kind: string }) => entry.kind === "AP").cents).toBe(12_215_000);
    expect(convex("books:trialBalance", {}).balanced).toBe(true);
    const documents = convex("room:documents", { caseCode: "DC-2026-0412" }); expect(documents.some((doc: { kind: string }) => doc.kind === "RECOVERY_CLAIM")).toBe(true); expect(documents.some((doc: { kind: string }) => doc.kind === "DISPUTE_LETTER")).toBe(true);
    const report = { phase: "V09", verified: true, realProvider: true, humanEvidence: false, origin: "AUTOMATED_TEST", model: "claude-sonnet-5-5", ranAt: new Date().toISOString(), testProcedureSeed: true, ops: opsEvidence, storm: state, money, journals, sourceHashes: Object.fromEntries(acceptedSources.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])) };
    writeFileSync("fixtures/agent-transcripts/v09-ui-live.json", JSON.stringify(report, null, 1));
    await page.screenshot({ animations: "disabled", path: "artifacts/v2/V09/live-final.png" });
  } finally { restore(); }
});

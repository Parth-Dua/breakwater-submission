import { afterEach, describe, expect, it, vi } from "vitest";
const { providerCreate } = vi.hoisted(() => ({ providerCreate: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: providerCreate }; } }));
import { api, internal } from "../../convex/_generated/api";
import { testBackend } from "../helpers/convex";
import { ensureOpsTask } from "../../convex/internal/toolExecution";
async function setup(code = "CL-203") {
  const t = testBackend(); await t.mutation(internal.seed.ensure, {});
  const claim = await t.run(async ctx => (await ctx.db.query("claims").withIndex("by_code", q => q.eq("claimCode", code)).unique())!);
  const runId = await t.mutation(internal.internal.workflow.start, { claimId: claim._id, schedule: false });
  const workItemId = await t.run(async ctx => (await ensureOpsTask(ctx, (await ctx.db.get(runId))!))!);
  const actorId = await t.run(ctx => ctx.db.insert("users", { identity: "test:ops-observation", active: true, role: "operations_reviewer", displayName: "Automated test reviewer", automationOnly: true }));
  const reviewer = t.withIdentity({ subject: actorId }), sessionId = await reviewer.mutation(api.workItems.claimTask, { workItemId });
  return { t, reviewer, actorId, claim, workItemId, sessionId };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); providerCreate.mockReset(); });
describe("Phase 06 semantic actions (mocked Convex/provider; not human-learning evidence)", () => {
  it("records genuine API interaction semantics, atomically submits source-backed finding and schedules continuation", async () => {
    vi.useFakeTimers(); vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-test-provider-key");
    const { t, reviewer, actorId, claim, workItemId, sessionId } = await setup();
    expect(await reviewer.mutation(api.workItems.claimTask, { workItemId })).toBe(sessionId);
    const results = await reviewer.mutation(api.workItems.searchArchive, { sessionId, search: "customs" }); const source = results.find(source => source.evidenceCode === "OPS-V-203")!; expect(source).toBeDefined();
    await reviewer.mutation(api.workItems.recordObservation, { sessionId, event: { type: "EVIDENCE_OPENED", evidenceId: source._id } });
    const viewed = await reviewer.query(api.workItems.get, { workItemId }); expect(viewed.work.finding).toBeUndefined(); expect(viewed.claim.evidenceIds).not.toContain(source._id); expect(viewed.events.at(-1)?.payload.assertsConclusion).toBe(false);
    expect(await reviewer.mutation(api.workItems.compareEvidence, { sessionId, evidenceId: source._id })).toMatchObject({ sameVoyage: true, signed: true, coveredMinutes: 2880, completeCoverage: true });
    await reviewer.mutation(api.workItems.recordObservation, { sessionId, event: { type: "TIMELINE_RANGE_SELECTED", startAt: source.startAt, endAt: source.endAt } });
    await reviewer.mutation(api.workItems.linkEvidence, { sessionId, evidenceId: source._id }); await reviewer.mutation(api.workItems.linkEvidence, { sessionId, evidenceId: source._id });
    expect((await reviewer.query(api.workItems.get, { workItemId })).claim.unverifiedCents).toBe(2_000_000);
    const finding = { cause: "CUSTOMS" as const, startAt: source.startAt, endAt: source.endAt, evidenceIds: [source._id], unavailable: false, note: "Signed source explicitly establishes customs clearance for the requested interval." };
    await reviewer.mutation(api.workItems.saveFinding, { sessionId, finding });
    const corrected = { ...finding, note: "Correction: interval and voyage match the signed customs Operations source; location alone establishes no cause." };
    await reviewer.mutation(api.workItems.saveFinding, { sessionId, finding: corrected });
    await reviewer.mutation(api.workItems.submitFinding, { sessionId, finding: corrected }); expect(await reviewer.mutation(api.workItems.submitFinding, { sessionId, finding: corrected })).toBe(workItemId);
    const final = await reviewer.query(api.workItems.get, { workItemId }); expect(final.work.status).toBe("SUBMITTED"); expect(final.session?.captureOrigin).toBe("AUTOMATED_TEST"); expect(final.session?.status).toBe("COMPLETED");
    expect(final.claim.revision).toBe(2); expect([final.claim.supportedCents, final.claim.unverifiedCents, final.claim.disputedCents]).toEqual([1_000_000, 0, 2_000_000]);
    expect(final.events.map(event => event.eventType)).toEqual(["WORK_SESSION_STARTED", "ARCHIVE_SEARCHED", "EVIDENCE_OPENED", "EVIDENCE_COMPARED", "TIMELINE_RANGE_SELECTED", "EVIDENCE_LINKED", "FINDING_EDITED", "DECISION_CORRECTED", "FINDING_SUBMITTED", "WORK_SESSION_COMPLETED"]);
    expect(final.events.every((event, index) => event.actorId === actorId && event.actorRole === "operations_reviewer" && Number.isSafeInteger(event.at) && event.sequence === index)).toBe(true);
    providerCreate.mockResolvedValueOnce({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "read", name: "get_claim_snapshot", input: {} }], model: "mock-provider", usage: { input_tokens: 1, output_tokens: 1 } }).mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: "Customs supported by signed source; apply actual charter exclusion." }], model: "mock-provider", usage: { input_tokens: 1, output_tokens: 1 } });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersToNextTimer());
    const runs = await t.run(ctx => ctx.db.query("agentRuns").withIndex("by_claim", q => q.eq("claimId", claim._id)).collect()); expect(runs.find(run => run.revision === 2)?.state).toBe("WAITING_EXTERNAL");
    expect((await t.run(ctx => ctx.db.query("journalEntries").withIndex("by_claim", q => q.eq("claimId", claim._id)).collect())).map(entry => entry.kind)).toEqual(["ACCRUAL"]);
    expect((await t.run(ctx => ctx.db.query("auditEvents").collect())).filter(event => event.eventType === "OPERATIONS_FINDING_SUBMITTED")).toHaveLength(1);
  });
  it("rejects wrong-voyage/unsigned sources, forged material events and another actor's session", async () => {
    const { t, reviewer, sessionId, workItemId } = await setup();
    const foreign = await t.run(ctx => ctx.db.query("evidence").withIndex("by_code", q => q.eq("evidenceCode", "OPS-V-204")).unique());
    await expect(reviewer.mutation(api.workItems.linkEvidence, { sessionId, evidenceId: foreign!._id })).rejects.toThrow("same voyage");
    await expect(reviewer.mutation(api.workItems.recordObservation, { sessionId, event: { type: "FINDING_SUBMITTED", role: "finance_controller" } as never })).rejects.toThrow();
    const otherId = await t.run(ctx => ctx.db.insert("users", { identity: "test:other", active: true, role: "operations_reviewer", displayName: "Other" })), other = t.withIdentity({ subject: otherId });
    await expect(other.mutation(api.workItems.claimTask, { workItemId })).rejects.toThrow("already claimed");
    await expect(other.mutation(api.workItems.searchArchive, { sessionId, search: "" })).rejects.toThrow("another reviewer");
    const unsigned = await setup("CL-209"), logs = await unsigned.reviewer.mutation(api.workItems.searchArchive, { sessionId: unsigned.sessionId, search: "customs" });
    await expect(unsigned.reviewer.mutation(api.workItems.linkEvidence, { sessionId: unsigned.sessionId, evidenceId: logs[0]._id })).rejects.toThrow("Signed Operations log");
  });
  it("throttles repeated view events and never turns document views into conclusions", async () => {
    const { reviewer, sessionId, workItemId } = await setup(), sources = await reviewer.mutation(api.workItems.searchArchive, { sessionId, search: "customs" });
    for (let i = 0; i < 20; i++) await reviewer.mutation(api.workItems.recordObservation, { sessionId, event: { type: "EVIDENCE_OPENED", evidenceId: sources[0]._id } });
    const actual = await reviewer.query(api.workItems.get, { workItemId }); expect(actual.events.filter(event => event.eventType === "EVIDENCE_OPENED")).toHaveLength(1); expect(actual.work.finding).toBeUndefined(); expect(actual.claim.unverifiedCents).toBe(2_000_000);
  });
  it("supports safe unavailable/clarification/queue-return paths without inventing a cause", async () => {
    const { reviewer, sessionId, workItemId } = await setup("CL-207"), review = await reviewer.query(api.workItems.get, { workItemId }), window = review.work.affectedIntervals![0];
    await reviewer.mutation(api.workItems.submitFinding, { sessionId, finding: { ...window, cause: "UNKNOWN", evidenceIds: [], note: "No signed Operations source is available for the requested interval.", unavailable: true } });
    const held = await reviewer.query(api.workItems.get, { workItemId }); expect(held.work.status).toBe("WAITING_INFORMATION"); expect(held.claim.status).toBe("ON_HOLD"); expect(held.claim.unverifiedCents).toBe(2_000_000);
    const nextSession = await reviewer.mutation(api.workItems.claimTask, { workItemId }); expect(nextSession).not.toBe(sessionId);
    await reviewer.mutation(api.workItems.requestClarification, { sessionId: nextSession, note: "Which signed repository contains the interval record?" }); expect((await reviewer.query(api.workItems.get, { workItemId })).work.clarification).toContain("signed repository");
    const returnedSession = await reviewer.mutation(api.workItems.claimTask, { workItemId }); await reviewer.mutation(api.workItems.reassign, { sessionId: returnedSession }); expect((await reviewer.query(api.workItems.get, { workItemId })).work.status).toBe("OPEN");
    await expect(reviewer.mutation(api.workItems.searchArchive, { sessionId: returnedSession, search: "" })).rejects.toThrow("closed");
  });
  it("enforces authenticated workspace isolation for task and claim reads", async () => {
    const { t, claim, workItemId } = await setup(); const otherScenario = await t.mutation(internal.seed.ensure, { scenarioCode: "breakwater-demo-uiunit" });
    const isolatedId = await t.run(ctx => ctx.db.insert("users", { identity: "test:isolated", role: "operations_reviewer", active: true, displayName: "Isolated", scenarioId: otherScenario.scenarioId, automationOnly: true })), isolated = t.withIdentity({ subject: isolatedId });
    await expect(isolated.query(api.workItems.get, { workItemId })).rejects.toThrow("outside authorized workspace");
    const own = await isolated.query(api.claims.getDetail, { code: claim.claimCode }); expect(own?.claim._id).not.toBe(claim._id);
    await expect(isolated.query(api.investigations.listForClaim, { claimId: claim._id })).rejects.toThrow("outside current workspace");
    const controllerId = await t.run(ctx => ctx.db.insert("users", { identity: "test:controller", role: "finance_controller", active: true, displayName: "Controller" }));
    expect(await t.withIdentity({ subject: controllerId }).query(api.workItems.listForCurrentRole, {})).toEqual([]);
    await expect(t.withIdentity({ subject: controllerId }).mutation(api.workItems.claimTask, { workItemId })).rejects.toThrow("Permission denied");
  });
});

import { describe, expect, it } from "vitest";
import { aisGaps, positionAt, routeAt, overlapMinutes, type AisSample } from "@/lib/trajectory";
import { api, internal } from "../../convex/_generated/api";
import { testBackend } from "../helpers/convex";
const hour = 3_600_000;
const points: AisSample[] = [{ at: 0, lon: 3, lat: 52, heading: 350, quality: "SYNTHETIC_RELIABLE" }, { at: 3 * hour, lon: 4, lat: 51, heading: 10, quality: "SYNTHETIC_RELIABLE" }, { at: 15 * hour, lon: 5, lat: 51, heading: 80, quality: "SYNTHETIC_RELIABLE" }];
describe("Phase 04 source-synchronized trajectory", () => {
  it("F14 interpolates only supported adjacent samples and rotates along the shortest heading", () => {
    expect(positionAt(points, 1.5 * hour)).toEqual({ lon: 3.5, lat: 51.5, heading: 0 });
    expect(positionAt(points, 0)?.lon).toBe(3);
    expect(positionAt(points, -1)).toBeNull(); expect(positionAt(points, 20 * hour)).toBeNull();
    expect(positionAt(points, 8 * hour)).toBeNull();
    expect(aisGaps(points)).toEqual([{ startAt: 3 * hour, endAt: 15 * hour }]);
    const uncertain = points.map((point, i) => i === 1 ? { ...point, quality: "UNCERTAIN" as const } : point);
    expect(positionAt(uncertain, 1.5 * hour)).toBeNull(); expect(positionAt(uncertain, 3 * hour)).toBeNull();
    expect(routeAt(points, 1.5 * hour).features.map(feature => feature.properties?.segment)).toEqual(["past", "future", "gap"]);
    expect(routeAt(points, 8 * hour).features.filter(feature => feature.properties?.segment === "gap")).toHaveLength(1);
  });
  it("clips selected durations to the claim and unions evidence without double counting", () => {
    expect(overlapMinutes({ startAt: 0, endAt: 180_000 }, [{ startAt: -60_000, endAt: 120_000 }, { startAt: 60_000, endAt: 240_000 }])).toBe(3);
    expect(overlapMinutes({ startAt: 0, endAt: 60_000 }, [{ startAt: 120_000, endAt: 180_000 }])).toBe(0);
  });
  it("derives canonical financial windows from verified source coverage, never AIS", async () => {
    const t = testBackend(); await t.mutation(internal.seed.ensure, {});
    const userId = await t.run(ctx => ctx.db.insert("users", { identity: "test:timeline", role: "auditor", active: true, displayName: "Timeline reader" }));
    const reader = t.withIdentity({ subject: userId });
    const detail = (await reader.query(api.claims.getDetail, { code: "CL-203" }))!;
    expect(detail.calculation).toEqual({ claimedCents: 3_000_000, supportedCents: 1_000_000, unverifiedCents: 2_000_000, disputedCents: 0, supportedMinutes: 1440, unverifiedMinutes: 2880, disputedMinutes: 0 });
    expect(detail.intervals.map(interval => [interval.treatment, (interval.endAt - interval.startAt) / 60_000])).toEqual([["SUPPORTED", 1440], ["UNVERIFIED", 2880]]);
    expect(detail.intervals[1].evidenceIds).toEqual([]);
    await t.run(async ctx => { const samples = await ctx.db.query("aisPoints").withIndex("by_voyage_at", q => q.eq("voyageId", detail.voyage._id)).collect(); for (const sample of samples) await ctx.db.delete(sample._id); });
    expect((await reader.query(api.claims.getDetail, { code: "CL-203" }))?.calculation).toEqual(detail.calculation);
    await t.run(async ctx => { const log = await ctx.db.query("evidence").withIndex("by_code", q => q.eq("evidenceCode", "OPS-V-203")).unique(); await ctx.db.patch(detail.claim._id, { evidenceIds: [...detail.claim.evidenceIds, log!._id] }); });
    const reviewed = (await reader.query(api.claims.getDetail, { code: "CL-203" }))!;
    expect(reviewed.intervals.map(interval => interval.treatment)).toEqual(["SUPPORTED", "DISPUTED"]);
    expect(reviewed.calculation.disputedCents).toBe(2_000_000);
  });
});

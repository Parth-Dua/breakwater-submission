import { describe,expect,it } from "vitest";
import { api,internal } from "../../convex/_generated/api";
import { testBackend } from "../helpers/convex";
import { fixtureAmounts,validateFixture,voyageFixtures } from "@/domain/fixtures";
import { intervalMinutes,validateIntervals } from "@/domain/intervals";
import { assertReconciliation } from "@/domain/claims";

describe("Phase 02 synthetic fixture integrity (mocked Convex)",()=>{
  it("defines twelve coherent scenarios and exact canonical cents/minutes",()=>{
    expect(voyageFixtures).toHaveLength(12);
    voyageFixtures.forEach(validateFixture);
    expect(fixtureAmounts(voyageFixtures[0])).toEqual({claimedCents:3_000_000,supportedCents:1_000_000,unverifiedCents:2_000_000,disputedCents:0});
    expect(fixtureAmounts(voyageFixtures.find(f=>f.fixtureId==="F16")!).supportedCents).toBe(62_500);
    expect(()=>assertReconciliation({claimedCents:10,supportedCents:5,unverifiedCents:2,disputedCents:0})).toThrow();
    expect(()=>validateIntervals([{startAt:0,endAt:120_000},{startAt:60_000,endAt:180_000}])).toThrow();
    expect(()=>intervalMinutes({startAt:0,endAt:1})).toThrow();
  });
  it("persists proper sources, alternate charter treatment, signed archive separation and balanced accruals",async()=>{
    const t=testBackend(); await t.mutation(internal.seed.ensure,{});
    await t.run(async ctx=>{
      const voyages=await ctx.db.query("voyages").collect();expect(voyages).toHaveLength(12);
      const canonical=voyages.find(v=>v.voyageCode==="V-203")!;
      const claim=(await ctx.db.query("claims").collect()).find(c=>c.voyageId===canonical._id)!;
      const invoice=await ctx.db.get(claim.invoiceId);
      expect(invoice?.amountCents).toBe(3_000_000);
      expect([claim.supportedCents,claim.unverifiedCents,claim.disputedCents]).toEqual([1_000_000,2_000_000,0]);
      const log=await ctx.db.query("evidence").withIndex("by_code",q=>q.eq("evidenceCode","OPS-V-203")).unique();
      expect(log?.visibility).toBe("OPS_ARCHIVE");expect(log?.signedStatus).toBe("SYNTHETIC_SIGNED");expect(claim.evidenceIds).not.toContain(log?._id);
      const charters=await ctx.db.query("charters").collect();
      expect(charters.find(c=>c.charterCode==="CH-ALPHA")?.terms.excludedCauses).toContain("CUSTOMS");
      expect(charters.find(c=>c.charterCode==="CH-BETA")?.terms.payableCauses).toContain("CUSTOMS");
      for(const voyage of voyages){
        const charter=await ctx.db.get(voyage.charterId);expect(charter!.terms.effectiveFrom).toBeLessThanOrEqual(voyage.startAt);expect(charter!.terms.effectiveTo).toBeGreaterThan(voyage.endAt);
        const points=await ctx.db.query("aisPoints").withIndex("by_voyage_at",q=>q.eq("voyageId",voyage._id)).collect();expect(points.length).toBeGreaterThan(2);
        points.forEach((point,index)=>{expect(point.synthetic).toBe(true);if(index)expect(point.at).toBeGreaterThan(points[index-1].at);});
      }
      const entries=await ctx.db.query("journalEntries").collect();
      for(const entry of entries){const lines=await ctx.db.query("journalLines").withIndex("by_entry",q=>q.eq("entryId",entry._id)).collect();expect(lines.reduce((sum,line)=>sum+(line.side==="DEBIT"?1:-1)*line.amountCents,0)).toBe(0);}
      const sources=await ctx.db.query("evidence").collect();expect(sources.every(source=>source.synthetic && source.content.includes("SYNTHETIC"))).toBe(true);
      expect(sources.some(source=>source.evidenceCode==="OPS-V-207")).toBe(false);
      expect(sources.find(source=>source.evidenceCode==="OPS-V-209")?.signedStatus).toBe("UNSIGNED");
      expect(sources.find(source=>source.evidenceCode==="OPS-V-208")?.voyageId).not.toBe(voyages.find(voyage=>voyage.voyageCode==="V-208")?._id);
      expect(voyages.find(voyage=>voyage.voyageCode==="V-204")?.heldOut).toBe(true);
      const procedures=await ctx.db.query("approvedProcedures").collect();expect(procedures).toHaveLength(8);expect(procedures.filter(p=>p.status==="ACTIVE")).toHaveLength(2);expect(procedures.some(p=>p.procedureCode==="P-009")).toBe(false);expect(await ctx.db.query("procedureCandidates").collect()).toHaveLength(0);
      const episodes=await ctx.db.query("caseEpisodes").collect();expect(episodes.map(e=>e.episodeCode)).toEqual(["H-011","H-012"]);expect(episodes.every(e=>e.kind==="HISTORICAL_SYNTHETIC"&&e.observedSteps.length===0)).toBe(true);
    });
  });
  it("is idempotent and reset restores business baseline while preserving another namespace",async()=>{
    const t=testBackend();await t.mutation(internal.seed.ensure,{});
    const snapshot=await t.query(internal.seed.inspect,{});
    expect((await t.mutation(internal.seed.ensure,{})).created).toBe(false);
    expect(await t.query(internal.seed.inspect,{})).toEqual(snapshot);
    await t.mutation(internal.seed.ensure,{scenarioCode:"breakwater-demo-other"});
    const other=await t.query(internal.seed.inspect,{scenarioCode:"breakwater-demo-other"});
    await t.run(async ctx=>{const claim=(await ctx.db.query("claims").collect()).find(c=>c.scenarioId===snapshot!.scenarioId)!;await ctx.db.patch(claim._id,{status:"ON_HOLD"});});
    await t.mutation(internal.seed.reset,{scenarioCode:"breakwater-demo"});
    expect(await t.query(internal.seed.inspect,{})).toEqual(snapshot);
    expect(await t.query(internal.seed.inspect,{scenarioCode:"breakwater-demo-other"})).toEqual(other);
    expect((await t.run(ctx=>ctx.db.query("claims").collect()))).toHaveLength(24);
    await expect(t.mutation(internal.seed.reset,{scenarioCode:"real-company"})).rejects.toThrow();
  });
  it("protects public reads and keeps the wider archive out of claim packets",async()=>{
    const t=testBackend();await t.mutation(internal.seed.ensure,{});
    await expect(t.query(api.claims.list,{})).rejects.toThrow("Authentication required");
    const userId=await t.run(ctx=>ctx.db.insert("users",{identity:"test:reader",role:"auditor",active:true,displayName:"Test Reader"}));
    const reader=t.withIdentity({subject:userId,tokenIdentifier:"test:reader"});
    expect(await reader.query(api.claims.list,{})).toHaveLength(12);
    const detail=await reader.query(api.claims.getDetail,{code:"CL-203"});expect(detail?.evidence).toHaveLength(2);expect(detail?.evidence.some(e=>e.visibility==="OPS_ARCHIVE")).toBe(false);
    const timeline=await reader.query(api.voyages.getTimeline,{voyageCode:"V-203"});expect(timeline?.aisPoints.length).toBeGreaterThan(2);
  });
});

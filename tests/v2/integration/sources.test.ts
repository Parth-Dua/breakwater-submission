import { describe, expect, test } from "vitest";
import { internal } from "../../../convex/_generated/api";
import { aisWindow, caseContextForVoyage, getDocument, searchCustomsPortal, searchMailbox, type ReadScope } from "../../../convex/sources/read";
import { baseAgentCapabilities, roleCapabilities, type Capability } from "../../../src/domain/capabilities";
import { utc } from "../../../src/domain/time";
import { testBackend } from "../helpers/convex";

const KESTREL_DOCS = ["DOC-NOR-KESTREL", "DOC-SOF-KESTREL", "DOC-SSZ-CUSTOMS-HOLD-1003", "DOC-SSZ-CUSTOMS-RELEASE-1004", "DOC-CP-THALASSA-2021", "DOC-RTM-ADVISORY-1024", "DOC-SSZ-LINEUP-0930"];
const PROCEDURE_GRANT: Capability = { id: "memory:M-0001:CUSTOMS_PORTAL", system: "CUSTOMS_PORTAL", access: "READ", scope: "CASE_VESSEL_AND_INTERVAL", grantedBy: { memoryItemId: "M-0001", version: 1 } };

async function setup() {
  const t = testBackend();
  await t.action(internal.world.import.importAll, { ns: "demo" });
  const items = await t.run(async ctx => Promise.all(KESTREL_DOCS.map(async code => ({ code, storageId: await ctx.storage.store(new Blob([code])) }))));
  await t.mutation(internal.world.importDocuments.register, { ns: "demo", items });
  // Simulate the scripted releases (V04 does this from world events): mailbox messages and portal records.
  await t.run(async ctx => {
    const doc = async (code: string) => (await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", "demo").eq("code", code)).unique())!;
    const kestrel = (await ctx.db.query("vessels").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "KESTREL")).unique())!;
    const santos = (await ctx.db.query("ports").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "BRSSZ")).unique())!;
    for (const [code, at] of [["DOC-NOR-KESTREL", utc("2026-10-01T09:30")], ["DOC-SOF-KESTREL", utc("2026-10-08T09:00")]] as const) {
      await ctx.db.insert("mailMessages", { ns: "demo", origin: "WORLD_SCRIPT", documentId: (await doc(code))._id, from: "x@example", subject: code, receivedAt: at, vesselImo: kestrel.imo, bodyText: "" });
    }
    await ctx.db.insert("customsRecords", { ns: "demo", origin: "WORLD_SCRIPT", portId: santos._id, vesselId: kestrel._id, kind: "HOLD", startAt: utc("2026-10-03T17:00"), documentId: (await doc("DOC-SSZ-CUSTOMS-HOLD-1003"))._id });
    await ctx.db.insert("customsRecords", { ns: "demo", origin: "WORLD_SCRIPT", portId: santos._id, vesselId: kestrel._id, kind: "RELEASE", startAt: utc("2026-10-03T17:00"), endAt: utc("2026-10-04T05:00"), documentId: (await doc("DOC-SSZ-CUSTOMS-RELEASE-1004"))._id });
  });
  const ids = await t.run(async ctx => {
    const voyage = (await ctx.db.query("voyages").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "KS-2609")).unique())!;
    const aster = (await ctx.db.query("vessels").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "ASTER_VALE")).unique())!;
    return { voyageId: voyage._id, vesselId: voyage.vesselId, portId: voyage.portId, asterId: aster._id };
  });
  return { t, ids };
}

describe("V03 systems of record via capabilities", () => {
  test("the customs release is unreachable without the procedure-granted capability (WORLD §2)", async () => {
    const { t, ids } = await setup();
    const simNow = utc("2026-10-24T00:00");
    await t.run(async ctx => {
      const context = await caseContextForVoyage(ctx, ids.voyageId, simNow);
      const base: ReadScope = { ns: "demo", capabilities: baseAgentCapabilities(), context, simNow };
      await expect(searchCustomsPortal(ctx, base, { portId: ids.portId, vesselId: ids.vesselId, from: utc("2026-10-03T00:00"), to: utc("2026-10-05T00:00") })).rejects.toThrow(/CAPABILITY_DENIED/);
      await expect(getDocument(ctx, base, "DOC-SSZ-CUSTOMS-RELEASE-1004")).rejects.toThrow(/CAPABILITY_DENIED/);
      const mailbox = await searchMailbox(ctx, base, { vesselId: ids.vesselId });
      expect(mailbox.results.map(item => item.documentCode)).toEqual(["DOC-NOR-KESTREL", "DOC-SOF-KESTREL"]); // the release is never in the mailbox

      const granted: ReadScope = { ...base, capabilities: [...baseAgentCapabilities(), PROCEDURE_GRANT] };
      const portal = await searchCustomsPortal(ctx, granted, { portId: ids.portId, vesselId: ids.vesselId, from: utc("2026-10-03T00:00"), to: utc("2026-10-05T00:00") });
      expect(portal.capabilityId).toBe(PROCEDURE_GRANT.id);
      expect(portal.results.find(record => record.kind === "RELEASE")).toMatchObject({ documentCode: "DOC-SSZ-CUSTOMS-RELEASE-1004", startAt: utc("2026-10-03T17:00"), endAt: utc("2026-10-04T05:00") });
      expect((await getDocument(ctx, granted, "DOC-SSZ-CUSTOMS-RELEASE-1004")).document.kind).toBe("CUSTOMS_RELEASE");
      // Scope: another vessel, or an interval outside the case window, is still denied.
      await expect(searchCustomsPortal(ctx, granted, { portId: ids.portId, vesselId: ids.asterId, from: utc("2026-10-03T00:00"), to: utc("2026-10-05T00:00") })).rejects.toThrow(/CAPABILITY_DENIED/);
      await expect(searchCustomsPortal(ctx, granted, { portId: ids.portId, vesselId: ids.vesselId, from: utc("2026-06-01T00:00"), to: utc("2026-06-02T00:00") })).rejects.toThrow(/CAPABILITY_DENIED/);
    });
  }, 60_000);

  test("contracts are not readable by the agent; Ops reads by role; port documents only for the case port", async () => {
    const { t, ids } = await setup();
    const simNow = utc("2026-10-24T12:00");
    await t.run(async ctx => {
      const context = await caseContextForVoyage(ctx, ids.voyageId, simNow);
      const agent: ReadScope = { ns: "demo", capabilities: baseAgentCapabilities(), context, simNow };
      await expect(getDocument(ctx, agent, "DOC-CP-THALASSA-2021")).rejects.toThrow(/CAPABILITY_DENIED/);
      const ops: ReadScope = { ...agent, capabilities: roleCapabilities("ops") };
      expect((await getDocument(ctx, ops, "DOC-SSZ-CUSTOMS-RELEASE-1004")).document.code).toBe("DOC-SSZ-CUSTOMS-RELEASE-1004");
      expect((await getDocument(ctx, agent, "DOC-SSZ-LINEUP-0930")).document.kind).toBe("PORT_ADVISORY"); // Santos = case port
      await expect(getDocument(ctx, agent, "DOC-RTM-ADVISORY-1024")).rejects.toThrow(/CAPABILITY_DENIED/); // Rotterdam ≠ case port
    });
  }, 60_000);

  test("sources only show what has arrived by sim time", async () => {
    const { t, ids } = await setup();
    await t.run(async ctx => {
      const early = utc("2026-10-02T00:00");
      const context = await caseContextForVoyage(ctx, ids.voyageId, early);
      const scope: ReadScope = { ns: "demo", capabilities: baseAgentCapabilities(), context, simNow: early };
      expect((await searchMailbox(ctx, scope, { vesselId: ids.vesselId })).results.map(item => item.documentCode)).toEqual(["DOC-NOR-KESTREL"]);
      await expect(getDocument(ctx, scope, "DOC-SOF-KESTREL")).rejects.toThrow(/MISSING_EVIDENCE/);
      const vesselAis = await aisWindow(ctx, { ...scope, context: await caseContextForVoyage(ctx, ids.voyageId, early) }, { vesselId: ids.asterId, from: 0, to: utc("2026-12-31T00:00") }).catch(error => error);
      expect(String(vesselAis)).toMatch(/CAPABILITY_DENIED/); // another vessel's AIS is out of scope
    });
  }, 60_000);
});

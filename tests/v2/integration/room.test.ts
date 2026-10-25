import { beforeAll, afterAll, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { api } from "../../../convex/_generated/api";
import { evidenceViews } from "../../../convex/room";
import { utc } from "../../../src/domain/time";
import { agentWorld, replayClient, setClaudeClient, setSimNow, type T, type Transcript } from "../helpers/agentWorld";
import { prepareStory, stormStory } from "../helpers/stories";

let t: T;
const kestrel = { caseCode: "DC-2026-0398" }, halden = { caseCode: "DC-2026-0405" };
beforeAll(async () => {
  t = await agentWorld({ pdfs: false });
  const client = replayClient(JSON.parse(readFileSync("fixtures/agent-transcripts/prepare.json", "utf8")) as Transcript);
  setClaudeClient(client); await prepareStory(t); expect(client.remaining()).toBe(0); setClaudeClient(null);
}, 120_000);
afterAll(() => setClaudeClient(null));

test("V08 baseline money, deadline, sources, timeline and semantic steps come from the case", async () => {
  expect(await t.query(api.room.money, kestrel)).toMatchObject({ billedCents: null, oweCents: 3_600_000, recoverCents: 1_800_000, netCents: -1_800_000, recoveryState: "est.", timeBar: { at: utc("2026-11-21T15:00"), days: 29, filed: false } });
  expect(await t.query(api.room.money, halden)).toMatchObject({ recoverCents: 2_700_000, recoveryState: "filed", timeBar: { filed: true } });
  const timeline = (await t.query(api.room.timeline, kestrel))!;
  expect(timeline.lanes.map(lane => lane.name)).toEqual(["AIS", "Charter", "Sale", "Docs", "Period"]);
  expect(timeline.docs.some(doc => doc.label === "N" && !!doc.quote)).toBe(true);
  expect(timeline.docs.every(doc => doc.at <= timeline.simNow)).toBe(true);
  const feed = await t.query(api.room.thinking, kestrel);
  expect(feed.now).toBeNull(); expect(feed.done.length).toBeGreaterThan(3);
  expect(feed.done.some(step => step.evidence.some(ref => ref.documentCode && ref.quote))).toBe(true);
  expect(JSON.stringify(feed)).not.toMatch(/leaseToken|tokensIn|tool_use|"_id"/);
  expect((await t.query(api.room.openAsk, kestrel))?.shortQuestion).not.toContain("$");
  expect((await t.query(api.desk.cases, {})).find(row => row.code === kestrel.caseCode)?.daysToTimeBar).toBe(29);
});

test("V08 view cursor clamps future requests and hides unreleased AIS/NOR; citations accept code or stored identity", async () => {
  const live = (await t.query(api.room.map, kestrel))!;
  const future = (await t.query(api.room.map, { ...kestrel, at: utc("2027-01-01T00:00") }))!;
  expect(future).toEqual(live); expect(live.track.every(p => p.at <= live.simNow)).toBe(true);
  const past = (await t.query(api.room.map, { ...kestrel, at: live.track[0].at - 1 }))!;
  expect(past.nor).toBeNull(); expect(past.track).toEqual([]); expect(past.vesselNow).toBeNull();
  await t.run(async ctx => {
    const doc = (await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", "demo").eq("code", "DOC-NOR-KESTREL")).unique());
    expect(doc).not.toBeNull();
    const byCode = await evidenceViews(ctx, [{ kind: "DOC", documentId: doc!.code, quote: "test quote" }]);
    expect(await evidenceViews(ctx, [{ kind: "DOC", documentId: doc!._id, quote: "test quote" }])).toEqual(byCode);
  });
});

test("V08 unfiled deadlines enter the Desk's seven-day risk count without a gateway write", async () => {
  await setSimNow(t, utc("2026-11-16T00:00"));
  expect((await t.query(api.desk.summary, {})).kpis.timeBars).toBe(1);
  await setSimNow(t, utc("2026-10-24T00:00"));
});

test("V08 deterministic Why uses actual evidence and preserves the filed partial decision", async () => {
  expect(await t.action(api.explain.why, { entityType: "CASE_TOTAL", entityId: kestrel.caseCode, field: "BILLED" })).toEqual({ text: "No owner invoice has arrived for this case.", citations: [] });
  const client = replayClient(JSON.parse(readFileSync("fixtures/agent-transcripts/storm.json", "utf8")) as Transcript);
  setClaudeClient(client); await stormStory(t); expect(client.remaining()).toBe(0); setClaudeClient(null);
  const aster = { caseCode: "DC-2026-0412" };
  expect(await t.query(api.room.money, aster)).toMatchObject({ oweCents: 11_015_000, recoverCents: 9_060_000, netCents: -1_955_000, waivedCents: 300_000, payableState: "approved", recoveryState: "filed" });
  const why = await t.action(api.explain.why, { entityType: "CASE_TOTAL", entityId: aster.caseCode, field: "NET" });
  expect(why.text).toContain("recovery less"); expect(why.citations.some(ref => ref.label === "Approval")).toBe(true);
  const map = (await t.query(api.room.map, aster))!;
  expect(map.nor).toMatchObject({ valid: false }); expect(map.nor!.distanceNm).toBeGreaterThan(0);
  expect((await t.query(api.room.memory, aster)).some(item => item.group === "Used here")).toBe(true);
}, 120_000);

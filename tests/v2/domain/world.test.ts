import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { distanceNm } from "../../../src/world/ais";
import { PORTS, portByCode } from "../../../src/world/company";
import { HANSA_SC_0917, LITORAL_PC_0802, NORDHAVN_CP_2019, NORDHAVN_CP_2019_TRUE, OKEANOS_CP_2020, ALNOOR_SC_0611, THALASSA_CP_2021 } from "../../../src/world/contracts";
import { generateHistory } from "../../../src/world/history";
import { PERIODS, periodFor } from "../../../src/world/policies";
import { generateScoreboard } from "../../../src/world/scoreboard";
import { ASTER_VALE_SOF_ROWS, ASTER_VALE_TRACK, KESTREL_SOF_ROWS, RTM_STORM } from "../../../src/world/scripts";
import { truthStatement } from "../../../src/world/truth";
import { localToUtc, sofTextToIso, utc } from "../../../src/domain/time";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const history = generateHistory();

describe("W-30 history", () => {
  test("32 closed cases with the planted patterns of WORLD §7", () => {
    expect(history).toHaveLength(32);
    const counts: Record<string, number> = {};
    for (const item of history) for (const pattern of item.patterns) counts[pattern] = (counts[pattern] ?? 0) + 1;
    expect(counts).toEqual({
      CUSTOMS_RELEASE_IN_PORTAL: 4, CUSTOMS_RELEASE_OUTSIDE_INTERVAL: 1, CUSTOMS_NO_RELEASE: 1,
      NORDHAVN_CLOSURE_AFTER_DEMURRAGE_COUNTED: 2, PREMATURE_NOR: 3, SOF_LOCAL_AS_UTC: 2, SHIFTING_BILLED: 4, GOODWILL_WAIVER: 1,
    });
    expect(history.filter(item => item.outcome.customsResolution).map(item => item.outcome.customsResolution).sort()).toEqual(["ESCALATED", "REJECTED", "VERIFIED", "VERIFIED", "VERIFIED", "VERIFIED"]);
    expect(history.find(item => item.patterns.includes("GOODWILL_WAIVER"))?.outcome.waiverCents).toBe(200_000);
    expect(history.filter(item => item.edits.length).every(item => item.voyage.charterCode.startsWith("NORDHAVN-CP-2019"))).toBe(true);
  });

  test("every journal balances, posts in Jan–Sep (LOCKED) and the books balance per period", () => {
    const perPeriod = new Map<string, number>();
    for (const item of history) for (const journal of item.journals) {
      const debit = journal.lines.filter(line => line.side === "DEBIT").reduce((sum, line) => sum + line.cents, 0);
      const credit = journal.lines.filter(line => line.side === "CREDIT").reduce((sum, line) => sum + line.cents, 0);
      expect(debit, journal.code).toBe(credit);
      expect(journal.lines.every(line => Number.isSafeInteger(line.cents) && line.cents > 0)).toBe(true);
      expect(periodFor(journal.postedAt).status, journal.code).toBe("LOCKED");
      expect(journal.periodCode).toBe(periodFor(journal.postedAt).code);
      perPeriod.set(journal.periodCode, (perPeriod.get(journal.periodCode) ?? 0) + debit - credit);
    }
    expect([...perPeriod.values()].every(net => net === 0)).toBe(true);
    expect(PERIODS.filter(period => period.status === "LOCKED").map(period => period.code)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(PERIODS.find(period => period.code === "2026-10")).toMatchObject({ status: "OPEN", lockAt: utc("2026-11-03T00:00") });
  });

  test("AIS tracks are chronological with ≥1 point per 30 min, and SOF rows convert back to their instants", () => {
    for (const item of history) {
      for (let index = 1; index < item.ais.length; index++) {
        expect(item.ais[index].at).toBeGreaterThan(item.ais[index - 1].at);
        expect(item.ais[index].at - item.ais[index - 1].at).toBeLessThanOrEqual(30 * 60_000);
      }
      for (const row of item.sof.rows) {
        const year = new Date(item.arrivalAt).getUTCFullYear();
        expect(() => localToUtc(sofTextToIso(row.localText, year), item.sof.ianaZone, { fold: row.fold })).not.toThrow();
      }
    }
  });
});

describe("W-31 determinism", () => {
  test("generators are deterministic and the committed fixtures are current", () => {
    expect(sha(generateHistory())).toBe(sha(history));
    expect(sha(generateScoreboard())).toBe(sha(generateScoreboard()));
    const fixture = JSON.parse(readFileSync("fixtures/world/history.json", "utf8"));
    expect(sha(fixture.cases)).toBe(sha(JSON.parse(JSON.stringify(history))));
    const score = JSON.parse(readFileSync("fixtures/world/scoreboard.json", "utf8"));
    expect(sha(score.voyages)).toBe(sha(JSON.parse(JSON.stringify(generateScoreboard()))));
  });
});

describe("WORLD geometry and scripts", () => {
  test("geofence polygons are closed rings", () => {
    for (const port of PORTS) for (const polygon of [port.anchorage, port.berth]) {
      const ring = polygon.coordinates[0];
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(ring.length).toBeGreaterThanOrEqual(4);
    }
  });

  test("Aster Vale: drift position ≈24 nm outside port limits; enters port limits at 18:00; shifts 08:00–12:00", () => {
    const rtm = portByCode("NLRTM");
    expect(distanceNm([2.95, 52.05], [rtm.anchorage.coordinates[0][0][0], 52.05])).toBeGreaterThan(23.5);
    expect(distanceNm([2.95, 52.05], [rtm.anchorage.coordinates[0][0][0], 52.05])).toBeLessThan(24.5);
    const inside = (p: { lon: number; lat: number }) => p.lon >= 3.60 && p.lon <= 3.98 && p.lat >= 51.95 && p.lat <= 52.08;
    expect(ASTER_VALE_TRACK.find(inside)?.at).toBe(utc("2026-10-24T18:00"));
    const moving = ASTER_VALE_TRACK.filter(p => p.at >= utc("2026-10-29T00:00") && p.sogKn >= 1).map(p => p.at);
    expect(moving[0]).toBe(utc("2026-10-30T08:00"));
    expect(moving[moving.length - 1]).toBe(utc("2026-10-30T11:30"));
    expect(ASTER_VALE_TRACK.find(p => p.at === utc("2026-10-30T12:00"))?.sogKn).toBeLessThan(1);
  });

  test("Aster Vale SOF (local time) converts to WORLD §4.1 UTC instants across the DST change", () => {
    const expected = ["2026-10-24T03:00", "2026-10-24T06:00", "2026-10-24T18:00", "2026-10-28T12:00", "2026-10-29T12:00", "2026-10-30T08:00", "2026-10-30T12:00", "2026-10-31T18:00", "2026-11-02T06:00"].map(utc);
    expect(ASTER_VALE_SOF_ROWS.map(row => localToUtc(sofTextToIso(row.localText, 2026), "Europe/Amsterdam", { fold: row.fold }))).toEqual(expected);
    expect(ASTER_VALE_SOF_ROWS.map(row => row.localText)).toEqual(["24.10 05:00", "24.10 08:00", "24.10 20:00", "28.10 13:00", "29.10 13:00", "30.10 09:00", "30.10 13:00", "31.10 19:00", "02.11 07:00"]);
    expect(KESTREL_SOF_ROWS.find(row => row.entry.startsWith("Customs"))?.localText).toBe("03.10 14:00");
  });

  test("RTM-STORM-2026-10 has the WORLD §4 timeline and AIS batches cover the track without overlap", () => {
    const events = RTM_STORM.events;
    expect(events[0]).toMatchObject({ type: "PORT_NOTICE", at: utc("2026-10-24T00:00") });
    expect(events[events.length - 1]).toMatchObject({ type: "EMAIL", at: utc("2026-12-09T10:00") });
    expect(events.every((event, index) => index === 0 || event.at >= events[index - 1].at)).toBe(true);
    const batched = events.filter(event => event.type === "AIS_BATCH").flatMap(event => (event.payload.points as { at: number }[]).map(point => point.at));
    expect(new Set(batched).size).toBe(batched.length);
  });
});

describe("WORLD answer key via the generator's ground truth (independent of the V05 engine)", () => {
  const closure = { kind: "PORT_CLOSURE" as const, startAt: utc("2026-10-28T12:00"), endAt: utc("2026-10-29T12:00"), verified: true };
  const shifting = { kind: "SHIFTING" as const, startAt: utc("2026-10-30T08:00"), endAt: utc("2026-10-30T12:00"), verified: true };
  const phyto = { kind: "CUSTOMS_HOLD" as const, startAt: utc("2026-10-30T12:00"), endAt: utc("2026-10-31T18:00"), verified: true };
  const av = [closure, shifting, phyto];
  test("Aster Vale payable/recoverable/accrual/owner (WORLD §5)", () => {
    expect(truthStatement({ terms: NORDHAVN_CP_2019_TRUE, laytimeStartAt: utc("2026-10-25T00:00"), completionAt: utc("2026-11-02T06:00"), intervals: av })).toMatchObject({ countedMinutes: 11_640, demurrageMinutes: 7_320, demurrageCents: 12_200_000, onDemurrageAt: utc("2026-10-28T00:00") });
    expect(truthStatement({ terms: NORDHAVN_CP_2019, laytimeStartAt: utc("2026-10-25T00:00"), completionAt: utc("2026-11-02T06:00"), intervals: av })).toMatchObject({ demurrageMinutes: 6_600, demurrageCents: 11_000_000 });
    expect(truthStatement({ terms: HANSA_SC_0917, laytimeStartAt: utc("2026-10-25T06:00"), completionAt: utc("2026-11-02T06:00"), intervals: av })).toMatchObject({ demurrageMinutes: 6_240, demurrageCents: 9_360_000 });
    expect(truthStatement({ terms: NORDHAVN_CP_2019, laytimeStartAt: utc("2026-10-25T00:00"), completionAt: utc("2026-11-01T00:00"), intervals: av }).demurrageCents).toBe(8_000_000);
    expect(truthStatement({ terms: NORDHAVN_CP_2019_TRUE, laytimeStartAt: utc("2026-10-24T12:00"), completionAt: utc("2026-11-02T07:00"), intervals: [closure, phyto] })).toMatchObject({ demurrageMinutes: 8_340, demurrageCents: 13_900_000 });
  });
  test("Kestrel and Halden Star (WORLD §6–7)", () => {
    const hold = { kind: "CUSTOMS_HOLD" as const, startAt: utc("2026-10-03T17:00"), endAt: utc("2026-10-04T05:00") };
    expect(truthStatement({ terms: THALASSA_CP_2021, laytimeStartAt: utc("2026-10-01T15:00"), completionAt: utc("2026-10-07T15:00"), intervals: [{ ...hold, verified: true }] }).demurrageCents).toBe(3_600_000);
    expect(truthStatement({ terms: LITORAL_PC_0802, laytimeStartAt: utc("2026-10-01T15:00"), completionAt: utc("2026-10-07T15:00"), intervals: [{ ...hold, verified: true }] }).demurrageCents).toBe(2_700_000);
    expect(truthStatement({ terms: LITORAL_PC_0802, laytimeStartAt: utc("2026-10-01T15:00"), completionAt: utc("2026-10-07T15:00"), intervals: [{ ...hold, verified: false }] }).demurrageCents).toBe(1_800_000);
    expect(truthStatement({ terms: OKEANOS_CP_2020, laytimeStartAt: utc("2026-10-12T12:00"), completionAt: utc("2026-10-17T12:00"), intervals: [] }).demurrageCents).toBe(3_000_000);
    expect(truthStatement({ terms: ALNOOR_SC_0611, laytimeStartAt: utc("2026-10-12T18:00"), completionAt: utc("2026-10-17T12:00"), intervals: [] }).demurrageCents).toBe(2_700_000);
  });
});

describe("scoreboard (WORLD §8)", () => {
  test("24 voyages; every catalog plant appears; answer keys are consistent", () => {
    const voyages = generateScoreboard();
    expect(voyages).toHaveLength(24);
    const plants = new Set(voyages.flatMap(voyage => voyage.plants));
    expect([...plants].sort()).toEqual(["ADMIN_FEE_ABOVE_MATERIALITY", "ADMIN_FEE_BELOW_MATERIALITY", "AIS_DARK_GAP", "CUSTOMS_NO_RELEASE", "CUSTOMS_RELEASE_IN_PORTAL", "DUPLICATE_INVOICE", "EUR_INVOICE", "PREMATURE_NOR", "SHIFTING_BILLED", "SOF_LOCAL_AS_UTC", "WEATHER_AFTER_DEMURRAGE", "WEATHER_BEFORE_DEMURRAGE_HALF"]);
    for (const voyage of voyages) {
      expect(voyage.plants.length).toBeLessThanOrEqual(3);
      expect(voyage.answerKey.payableCents).toBe(voyage.truth.payable.totalCents);
      expect(voyage.ownerInvoice.totalCents - voyage.answerKey.payableCents).toBe(voyage.answerKey.disputeCents);
    }
  });
});

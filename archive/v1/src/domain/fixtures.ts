import { assertReconciliation, lineCents } from "./claims";
import { intervalMinutes } from "./intervals";

export const SEED_VERSION = 1;
export const DEFAULT_SCENARIO = "breakwater-demo";
export type FixtureDefinition = { voyageCode: string; vessel: string; fixtureId: string; charter: "ALPHA" | "BETA"; heldOut: boolean; minutes: number; closureMinutes: number; log: "signed" | "missing" | "wrong-voyage" | "unsigned"; exception?: boolean; injection?: boolean; aisGap?: boolean; lockedAccrual?: boolean };
const base = { charter: "ALPHA", heldOut: false, minutes: 4320, closureMinutes: 1440, log: "signed" } as const;
export const voyageFixtures: FixtureDefinition[] = [
  { ...base, voyageCode:"V-203", vessel:"MV Aster Vale", fixtureId:"F01" },
  { ...base, voyageCode:"V-204", vessel:"MV Cobalt Reach", fixtureId:"F03", heldOut:true },
  { ...base, voyageCode:"V-205", vessel:"MV Solstice Bay", fixtureId:"F04", charter:"BETA", heldOut:true },
  { ...base, voyageCode:"V-206", vessel:"MV Arden Tide", fixtureId:"F05", exception:true },
  { ...base, voyageCode:"V-207", vessel:"MV Kestrel Sound", fixtureId:"F06", log:"missing" },
  { ...base, voyageCode:"V-208", vessel:"MV Sable Current", fixtureId:"F07", log:"wrong-voyage" },
  { ...base, voyageCode:"V-209", vessel:"MV Linden Strait", fixtureId:"F08", log:"unsigned" },
  { ...base, voyageCode:"V-210", vessel:"MV Northward", fixtureId:"F09", closureMinutes:4320, log:"missing" },
  { ...base, voyageCode:"V-211", vessel:"MV Fenwick Star", fixtureId:"F11", lockedAccrual:true },
  { ...base, voyageCode:"V-212", vessel:"MV Ember Coast", fixtureId:"F12", injection:true },
  { ...base, voyageCode:"V-213", vessel:"MV Oriole Point", fixtureId:"F14", aisGap:true },
  { ...base, voyageCode:"V-214", vessel:"MV Islay Dawn", fixtureId:"F16", minutes:90, closureMinutes:90, log:"missing" },
];
export function fixtureAmounts(fixture: FixtureDefinition) {
  const claimedCents = lineCents(fixture.minutes,1_000_000);
  const supportedCents = lineCents(fixture.closureMinutes,1_000_000);
  const value = { claimedCents, supportedCents, unverifiedCents:claimedCents-supportedCents, disputedCents:0 };
  assertReconciliation(value);
  return value;
}
export function validateFixture(fixture: FixtureDefinition): void {
  if (!fixture.voyageCode || fixture.closureMinutes > fixture.minutes) throw new Error("Invalid fixture coverage");
  intervalMinutes({ startAt:0, endAt:fixture.minutes*60_000 });
  fixtureAmounts(fixture);
}

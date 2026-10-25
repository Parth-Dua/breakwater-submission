// AIS track builder: piecewise-linear legs sampled every `stepMinutes`. A point's SOG/COG describe the leg the
// vessel is on at that instant (0 kn when stationary), so movement intervals are [first moving point, arrival).
import type { AisPoint } from "./types";

const MINUTE = 60_000;
const NM_PER_DEG_LAT = 60;

export type Waypoint = { at: number; lon: number; lat: number };

export function distanceNm(a: [number, number], b: [number, number]): number {
  const R = 3440.065;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return (Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360));
}

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let state = h >>> 0;
  return () => {
    state |= 0; state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value: number, digits = 5) => Number(value.toFixed(digits));

/**
 * Samples waypoints every stepMinutes from the first to the last waypoint (inclusive). Consecutive waypoints with
 * the same position are a stationary leg. `jitterSeed` adds sub-50 m swing at anchor/berth (SOG stays < 0.3 kn).
 * `gaps` removes points inside the given [start, end) windows (AIS dark periods).
 */
export function buildTrack(waypoints: Waypoint[], opts: { stepMinutes?: number; jitterSeed?: string; gaps?: { startAt: number; endAt: number }[] } = {}): AisPoint[] {
  const step = (opts.stepMinutes ?? 30) * MINUTE;
  const random = opts.jitterSeed ? rng(opts.jitterSeed) : null;
  const points: AisPoint[] = [];
  const first = waypoints[0].at, last = waypoints[waypoints.length - 1].at;
  for (let at = first; at <= last; at += step) {
    if (opts.gaps?.some(gap => at >= gap.startAt && at < gap.endAt)) continue;
    let legIndex = waypoints.findIndex((waypoint, index) => index < waypoints.length - 1 && at >= waypoint.at && at < waypoints[index + 1].at);
    if (legIndex === -1) legIndex = waypoints.length - 2;
    const a = waypoints[legIndex], b = waypoints[legIndex + 1];
    const fraction = at >= b.at ? 1 : (at - a.at) / (b.at - a.at);
    const lon = a.lon + (b.lon - a.lon) * fraction;
    const lat = a.lat + (b.lat - a.lat) * fraction;
    const moving = (a.lon !== b.lon || a.lat !== b.lat) && at < b.at;
    const legNm = distanceNm([a.lon, a.lat], [b.lon, b.lat]);
    const sogKn = moving ? round(legNm / ((b.at - a.at) / 3_600_000), 1) : random ? round(random() * 0.25, 2) : 0;
    const swing = !moving && random ? (random() - 0.5) * 0.0008 : 0;
    points.push({ at, lon: round(lon + swing), lat: round(lat + swing / 2), sogKn, cogDeg: moving ? bearing([a.lon, a.lat], [b.lon, b.lat]) : random ? Math.floor(random() * 360) : 0 });
  }
  return points;
}

export const NM_PER_DEGREE_LAT = NM_PER_DEG_LAT;

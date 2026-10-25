// CONTRACTS §5 geo.ts — geofences and AIS analysis. GeoJSON [lon, lat], WGS84, nautical miles. Pure.
import type { Interval } from "./intervals";

export type Polygon = { type: "Polygon"; coordinates: number[][][] };
export type AisPoint = { at: number; lon: number; lat: number; sogKn: number; cogDeg: number };

const R_NM = 3440.065;
const MINUTE = 60_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineNm(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(h));
}

/** Ray casting on the outer ring. Points on an edge count as inside. */
export function pointInPolygon(point: [number, number], polygon: Polygon): boolean {
  const ring = polygon.coordinates[0];
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const onEdge = Math.abs((x - xi) * (yj - yi) - (y - yi) * (xj - xi)) < 1e-12 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj);
    if (onEdge) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance (nm, 1 decimal) from a point to the polygon; 0 inside. Closest point found in a local equirectangular projection. */
export function distanceToPolygonNm(point: [number, number], polygon: Polygon): number {
  if (pointInPolygon(point, polygon)) return 0;
  const ring = polygon.coordinates[0];
  const k = Math.cos(toRad(point[1]));
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
    const px = (point[0] - ax) * k, py = point[1] - ay, vx = (bx - ax) * k, vy = by - ay;
    const t = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy || 1)));
    const closest: [number, number] = [ax + (bx - ax) * t, ay + (by - ay) * t];
    best = Math.min(best, haversineNm(point, closest));
  }
  return Math.round(best * 10) / 10;
}

/** Position at an instant: linear interpolation; `gap` when the bracketing points are more than maxGapMinutes apart. */
export function positionAt(points: AisPoint[], at: number, maxGapMinutes = 60): { lon: number; lat: number; interpolated: boolean; gap: boolean } | null {
  if (!points.length || at < points[0].at) return null;
  const last = points[points.length - 1];
  if (at >= last.at) return { lon: last.lon, lat: last.lat, interpolated: at > last.at, gap: (at - last.at) > maxGapMinutes * MINUTE };
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].at <= at) lo = mid; else hi = mid; }
  const a = points[lo], b = points[hi];
  if (a.at === at) return { lon: a.lon, lat: a.lat, interpolated: false, gap: false };
  const f = (at - a.at) / (b.at - a.at);
  return { lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f, interpolated: true, gap: (b.at - a.at) > maxGapMinutes * MINUTE };
}

/** First AIS instant inside the polygon (the vessel's arrival within port limits). */
export function detectGeofenceEntry(points: AisPoint[], polygon: Polygon): number | null {
  for (const point of points) if (pointInPolygon([point.lon, point.lat], polygon)) return point.at;
  return null;
}

/** Movement intervals: [first point with SOG ≥ minSogKn, first following point below it), at least minMinutes long. */
export function detectMovementIntervals(points: AisPoint[], minSogKn = 1, minMinutes = 60): Interval[] {
  const intervals: Interval[] = [];
  let start: number | null = null;
  for (const point of points) {
    const moving = point.sogKn >= minSogKn;
    if (moving && start === null) start = point.at;
    if (!moving && start !== null) { if (point.at - start >= minMinutes * MINUTE) intervals.push({ startAt: start, endAt: point.at }); start = null; }
  }
  return intervals;
}

/** Gaps between consecutive AIS points longer than maxGapMinutes (dark periods). */
export function detectAisGaps(points: AisPoint[], maxGapMinutes = 60): Interval[] {
  const gaps: Interval[] = [];
  for (let i = 1; i < points.length; i++) if (points[i].at - points[i - 1].at > maxGapMinutes * MINUTE) gaps.push({ startAt: points[i - 1].at, endAt: points[i].at });
  return gaps;
}

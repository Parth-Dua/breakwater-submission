import type * as GeoJSON from "geojson";
export type AisSample = { at: number; lon: number; lat: number; heading: number; quality: "SYNTHETIC_RELIABLE" | "UNCERTAIN" };
export type TimeWindow = { startAt: number; endAt: number };
export const MAX_AIS_GAP_MS = 6 * 60 * 60_000;
export function aisGaps(points: AisSample[]): TimeWindow[] {
  return points.slice(1).flatMap((point, i) => point.at - points[i].at > MAX_AIS_GAP_MS || point.quality === "UNCERTAIN" || points[i].quality === "UNCERTAIN" ? [{ startAt: points[i].at, endAt: point.at }] : []);
}
export function positionAt(points: AisSample[], at: number): { lon: number; lat: number; heading: number } | null {
  const exact = points.find(point => point.at === at);
  if (exact) return exact.quality === "UNCERTAIN" ? null : { lon: exact.lon, lat: exact.lat, heading: exact.heading };
  const right = points.findIndex(point => point.at > at);
  if (right < 1) return null;
  const a = points[right - 1], b = points[right];
  if (b.at - a.at > MAX_AIS_GAP_MS || a.quality === "UNCERTAIN" || b.quality === "UNCERTAIN") return null;
  const fraction = (at - a.at) / (b.at - a.at), angle = ((b.heading - a.heading + 540) % 360) - 180;
  return { lon: a.lon + (b.lon - a.lon) * fraction, lat: a.lat + (b.lat - a.lat) * fraction, heading: (a.heading + angle * fraction + 360) % 360 };
}
export function routeAt(points: AisSample[], at: number): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], coordinates = [[a.lon, a.lat], [b.lon, b.lat]];
    if (b.at - a.at > MAX_AIS_GAP_MS || a.quality === "UNCERTAIN" || b.quality === "UNCERTAIN") {
      features.push({ type: "Feature", properties: { segment: "gap" }, geometry: { type: "LineString", coordinates } });
    } else if (at > a.at && at < b.at) {
      const position = positionAt(points, at)!;
      features.push({ type: "Feature", properties: { segment: "past" }, geometry: { type: "LineString", coordinates: [coordinates[0], [position.lon, position.lat]] } }, { type: "Feature", properties: { segment: "future" }, geometry: { type: "LineString", coordinates: [[position.lon, position.lat], coordinates[1]] } });
    } else features.push({ type: "Feature", properties: { segment: b.at <= at ? "past" : "future" }, geometry: { type: "LineString", coordinates } });
  }
  return { type: "FeatureCollection", features };
}
export function overlapMinutes(range: TimeWindow, windows: TimeWindow[]): number {
  const clipped = windows.map(window => ({ startAt: Math.max(range.startAt, window.startAt), endAt: Math.min(range.endAt, window.endAt) })).filter(window => window.startAt < window.endAt).sort((a, b) => a.startAt - b.startAt);
  let milliseconds = 0, end = -Infinity;
  for (const window of clipped) { milliseconds += Math.max(0, window.endAt - Math.max(end, window.startAt)); end = Math.max(end, window.endAt); }
  return Math.floor(milliseconds / 60_000);
}

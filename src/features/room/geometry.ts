import type { Feature, FeatureCollection, LineString } from "geojson";
import type { RoomMap } from "../../../convex/room";
import { haversineNm } from "@/domain/geo";

export function closestPortPoint(point: [number, number], ring: number[][]): [number, number] {
  const k = Math.cos(point[1] * Math.PI / 180); let best: [number, number] = [ring[0][0], ring[0][1]], distance = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i], vx = (b[0] - a[0]) * k, vy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, (((point[0] - a[0]) * k) * vx + (point[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
    const next: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d = haversineNm(point, next);
    if (d < distance) { best = next; distance = d; }
  }
  return best;
}

/** Only points returned at/before the view cursor become map geometry. */
export function trackFeatures(data: RoomMap): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  for (let i = 1; i < data.track.length; i++) {
    const a = data.track[i - 1], b = data.track[i];
    const gap = data.gaps.some(gap => gap.startAt <= a.at && gap.endAt >= b.at);
    const shifting = data.shifting.some(interval => interval.startAt <= a.at && interval.endAt >= b.at);
    features.push({ type: "Feature", properties: { kind: gap ? "gap" : shifting ? "shift" : "past" }, geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } });
  }
  return { type: "FeatureCollection", features };
}

export function boundsFor(data: RoomMap): [[number, number], [number, number]] {
  const points = [...data.port.anchorage.coordinates[0], ...data.port.berth.coordinates[0], ...data.track.map(point => [point.lon, point.lat])];
  if (data.nor) points.push([data.nor.lon, data.nor.lat]);
  return [[Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))], [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]];
}

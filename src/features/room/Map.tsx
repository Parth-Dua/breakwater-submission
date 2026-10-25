"use client";
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibre, Marker, StyleSpecification } from "maplibre-gl";
import type { EvidenceView, RoomMap } from "../../../convex/room";
import { EmptyLine } from "@/components/ui/feedback";
import { formatNm, formatTime } from "@/lib/format";
import { boundsFor, closestPortPoint, trackFeatures } from "./geometry";

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const sourceData = (map: MapLibre, id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
function fallbackStyle(port: string): StyleSpecification {
  return { version: 8, sources: { coast: { type: "geojson", data: `/geo/coast-${port.startsWith("NL") ? "nl" : port.startsWith("BR") ? "br" : "world"}.json` } }, layers: [{ id: "water", type: "background", paint: { "background-color": "#F2F4F7" } }, { id: "coast", type: "line", source: "coast", paint: { "line-color": "#98A2B3", "line-width": 1.2 } }] };
}
function updateLayers(map: MapLibre, data: RoomMap) {
  if (!map.getSource("bw-port")) {
    for (const id of ["bw-port", "bw-track", "bw-nor"]) map.addSource(id, { type: "geojson", data: empty });
    map.addLayer({ id: "bw-anchorage-fill", type: "fill", source: "bw-port", filter: ["==", ["get", "kind"], "anchorage"], paint: { "fill-color": "#1D4ED8", "fill-opacity": .06 } });
    map.addLayer({ id: "bw-anchorage-line", type: "line", source: "bw-port", filter: ["==", ["get", "kind"], "anchorage"], paint: { "line-color": "#1D4ED8", "line-opacity": .4, "line-width": 1 } });
    map.addLayer({ id: "bw-berth-fill", type: "fill", source: "bw-port", filter: ["==", ["get", "kind"], "berth"], paint: { "fill-color": "#0B1F3A", "fill-opacity": .08 } });
    map.addLayer({ id: "bw-berth-line", type: "line", source: "bw-port", filter: ["==", ["get", "kind"], "berth"], paint: { "line-color": "#0B1F3A", "line-width": 1 } });
    for (const [kind, color] of [["past", "#475467"], ["shift", "#B54708"], ["gap", "#98A2B3"]]) map.addLayer({ id: `bw-${kind}`, type: "line", source: "bw-track", filter: ["==", ["get", "kind"], kind], paint: { "line-color": color, "line-width": kind === "shift" ? 2.5 : 1.5, ...(kind === "gap" ? { "line-dasharray": [3, 3] } : {}) } });
    map.addLayer({ id: "bw-nor-line", type: "line", source: "bw-nor", paint: { "line-color": "#B42318", "line-width": 1, "line-dasharray": [4, 4] } });
  }
  sourceData(map, "bw-port", { type: "FeatureCollection", features: [{ type: "Feature", properties: { kind: "anchorage" }, geometry: data.port.anchorage }, { type: "Feature", properties: { kind: "berth" }, geometry: data.port.berth }] });
  sourceData(map, "bw-track", trackFeatures(data));
  sourceData(map, "bw-nor", data.nor && !data.nor.valid ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[data.nor.lon, data.nor.lat], closestPortPoint([data.nor.lon, data.nor.lat], data.port.anchorage.coordinates[0])] } }] } : empty);
}

export function VesselMap({ data, onEvidence }: { data: RoomMap | null | undefined; onEvidence: (evidence: EvidenceView) => void }) {
  const container = useRef<HTMLDivElement>(null), map = useRef<MapLibre | null>(null), marker = useRef<Marker | null>(null), labels = useRef<Marker[]>([]);
  const latest = useRef(data), callback = useRef(onEvidence);
  useEffect(() => { latest.current = data; callback.current = onEvidence; }, [data, onEvidence]);
  const [failed, setFailed] = useState(false), [ready, setReady] = useState(false);
  const portCode = data?.port.code;
  useEffect(() => {
    if (!container.current || !portCode) return;
    let disposed = false, observer: ResizeObserver | null = null;
    const abort = new AbortController();
    void import("maplibre-gl").then(async lib => {
      if (disposed || !container.current || !latest.current) return;
      lib.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
      let instance: MapLibre;
      try { instance = new lib.Map({ container: container.current, style: fallbackStyle(portCode), attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, renderWorldCopies: false }); }
      catch { setFailed(true); return; }
      map.current = instance;
      instance.addControl(new lib.NavigationControl({ showCompass: false }), "bottom-right");
      instance.on("style.load", () => { if (latest.current) updateLayers(instance, latest.current); });
      instance.on("load", () => {
        if (!latest.current) return;
        instance.fitBounds(boundsFor(latest.current), { padding: 64, maxZoom: 12, duration: 0 });
        setReady(true);
      });
      let remote = false, fallenBack = false;
      instance.on("error", () => { if (remote && !fallenBack) { fallenBack = true; remote = false; instance.setStyle(fallbackStyle(portCode)); } });
      observer = new ResizeObserver(() => { instance.resize(); if (latest.current && instance.loaded()) instance.fitBounds(boundsFor(latest.current), { padding: 64, maxZoom: 12, duration: 0 }); }); observer.observe(container.current);
      // An immediately usable bundled base remains if style/tiles cannot load.
      const timeout = setTimeout(() => abort.abort(), 4_000);
      try {
        const response = await fetch(STYLE, { signal: abort.signal });
        if (response.ok && !disposed) { const style = await response.json() as StyleSpecification; if (!disposed) { remote = true; instance.setStyle(style); } }
      } catch { /* bundled coastline remains */ } finally { clearTimeout(timeout); }
    }).catch(() => setFailed(true));
    return () => { disposed = true; abort.abort(); observer?.disconnect(); labels.current.forEach(label => label.remove()); labels.current = []; marker.current?.remove(); marker.current = null; map.current?.remove(); map.current = null; };
  }, [portCode]);

  useEffect(() => {
    const instance = map.current;
    if (!data || !instance || !ready) return;
    let animation = 0, cancelled = false;
    void import("maplibre-gl").then(lib => {
      if (cancelled || !map.current) return;
      if (instance.isStyleLoaded()) updateLayers(instance, data);
      labels.current.forEach(label => label.remove()); labels.current = [];
      const ring = data.port.anchorage.coordinates[0];
      const center: [number, number] = [ring.reduce((sum, p) => sum + p[0], 0) / ring.length, ring.reduce((sum, p) => sum + p[1], 0) / ring.length];
      const portLabel = document.createElement("span"); portLabel.textContent = "Port limits"; portLabel.className = "rounded bg-white/90 px-2 py-1 text-[11px] text-agent";
      labels.current.push(new lib.Marker({ element: portLabel }).setLngLat(center).addTo(instance));
      if (data.nor) {
        const nor = data.nor, el = document.createElement("button"); el.type = "button"; el.className = `rounded border border-current bg-white px-2 py-1 font-mono text-[12px] ${nor.valid ? "text-pos" : "text-neg"}`;
        el.textContent = `${nor.valid ? "✓" : "×"} NOR ${formatTime(nor.at).split(" ").at(-1)}`; el.setAttribute("data-testid", "nor-pin");
        el.addEventListener("click", () => { if (nor.evidence[0]) callback.current(nor.evidence[0]); });
        labels.current.push(new lib.Marker({ element: el, anchor: "bottom" }).setLngLat([nor.lon, nor.lat]).addTo(instance));
        if (!nor.valid && nor.distanceNm > 0) {
          const nearest = closestPortPoint([nor.lon, nor.lat], ring), label = document.createElement("span"); label.className = "rounded bg-white/95 px-2 py-1 font-mono text-[12px] text-neg"; label.textContent = formatNm(nor.distanceNm); label.setAttribute("data-testid", "nor-distance");
          labels.current.push(new lib.Marker({ element: label }).setLngLat([(nor.lon + nearest[0]) / 2, (nor.lat + nearest[1]) / 2]).addTo(instance));
        }
      }
      const vessel = data.vesselNow;
      if (!vessel) { marker.current?.remove(); marker.current = null; instance.fitBounds(boundsFor(data), { padding: 64, maxZoom: 12, duration: 0 }); return; }
      if (!marker.current) {
        const el = document.createElement("div"); el.className = "h-5 w-4 bg-navy"; el.style.clipPath = "polygon(50% 0%,100% 100%,50% 75%,0% 100%)"; el.setAttribute("role", "img"); el.setAttribute("aria-label", "Vessel position");
        marker.current = new lib.Marker({ element: el, rotationAlignment: "map" }).setLngLat([vessel.lon, vessel.lat]).setRotation(vessel.cogDeg).addTo(instance);
      }
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = !reduced && data.viewAt === data.simNow && data.clockJump ? Math.max(0, 1200 - (Date.now() - data.clockJump.atWall)) : 0;
      const start = marker.current.getLngLat(), began = performance.now();
      const move = () => {
        if (cancelled || !marker.current) return;
        const t = duration ? Math.min(1, (performance.now() - began) / duration) : 1, eased = t * t * (3 - 2 * t);
        marker.current.setLngLat([start.lng + (vessel.lon - start.lng) * eased, start.lat + (vessel.lat - start.lat) * eased]).setRotation(vessel.cogDeg);
        if (t < 1) animation = requestAnimationFrame(move);
      };
      move();
      instance.fitBounds(boundsFor(data), { padding: 64, maxZoom: 12, duration });
    });
    return () => { cancelled = true; cancelAnimationFrame(animation); };
  }, [data, ready]);

  if (data === null) return <EmptyLine>No case yet</EmptyLine>;
  return <div className="relative h-full min-h-0 overflow-hidden rounded-[var(--radius-panel)] bg-surface-2" role="region" aria-label="Vessel map" data-testid="vessel-map" data-view-at={data?.viewAt} data-track-end={data?.track.at(-1)?.at}>
    <div ref={container} className="h-full w-full" />
    {!ready && <div className="pointer-events-none absolute inset-0 grid place-items-center text-[12px] text-ink-2">{failed ? "Map unavailable" : "Loading map"}</div>}
    {data?.vesselNow?.gap && <span className="absolute bottom-3 left-3 rounded border border-border bg-surface px-2 py-1 font-mono text-[11px] text-warn">Last AIS · {formatTime(data.vesselNow.at)}</span>}
  </div>;
}

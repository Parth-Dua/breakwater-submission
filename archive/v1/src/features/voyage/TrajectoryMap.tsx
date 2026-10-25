"use client";
import { useEffect, useRef, useState } from "react";
import { Map as LibreMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import { positionAt, routeAt, type AisSample } from "@/lib/trajectory";
// MapLibre v6 requires an explicit worker asset URL in bundler builds.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

export default function TrajectoryMap({ points, at }: { points: AisSample[]; at: number }) {
  const container = useRef<HTMLDivElement>(null), map = useRef<LibreMap | null>(null), marker = useRef<Marker | null>(null);
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!container.current || !points.length) return;
    let instance: LibreMap;
    try {
      instance = new LibreMap({ container: container.current, center: [3.85, 52.02], zoom: 8.7, attributionControl: false, canvasContextAttributes: { antialias: true }, style: {
        version: 8,
        sources: { coastline: { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[4.15, 52.4], [4.09, 52.2], [4.06, 52.08], [4.12, 51.99], [4.02, 51.94], [3.98, 51.8], [4.25, 51.55], [5, 51.55], [5, 52.4], [4.15, 52.4]]] } } } },
        layers: [{ id: "sea", type: "background", paint: { "background-color": "#102735" } }, { id: "land", type: "fill", source: "coastline", paint: { "fill-color": "#253e48" } }, { id: "coast", type: "line", source: "coastline", paint: { "line-color": "#4c6870", "line-width": 1 } }],
      } });
    } catch { queueMicrotask(() => setFailed(true)); return; }
    map.current = instance;
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const lngs = points.map(point => point.lon), lats = points.map(point => point.lat);
    const fitRoute = () => instance.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: { top: 85, right: 55, bottom: 70, left: 45 }, duration: 0, maxZoom: 10 });
    instance.on("load", () => {
      instance.addSource("trajectory", { type: "geojson", data: routeAt(points, points[0].at) });
      for (const [segment, color, dashed] of [["future", "#6f8996", true], ["past", "#79cfc2", false], ["gap", "#e6b55e", true]] as const) {
        instance.addLayer({ id: segment, type: "line", source: "trajectory", filter: ["==", ["get", "segment"], segment], paint: { "line-color": color, "line-width": segment === "past" ? 3 : 2, ...(dashed ? { "line-dasharray": [3, 3] } : {}) } });
      }
      const element = document.createElement("div"); element.className = "vessel-marker"; element.setAttribute("aria-label", "Vessel position");
      const hull = document.createElement("span"); element.appendChild(hull);
      marker.current = new Marker({ element, rotationAlignment: "map" }).setLngLat([points[0].lon, points[0].lat]).addTo(instance);
      fitRoute();
      setLoaded(true);
    });
    instance.on("error", () => setFailed(true));
    const observer = new ResizeObserver(() => { instance.resize(); fitRoute(); }); observer.observe(container.current);
    return () => { observer.disconnect(); marker.current?.remove(); marker.current = null; map.current = null; instance.remove(); };
  }, [points]);
  useEffect(() => {
    if (!loaded || !map.current) return;
    const source = map.current.getSource("trajectory") as GeoJSONSource | undefined;
    void source?.setData(routeAt(points, at)).catch(() => setFailed(true));
    const position = positionAt(points, at), element = marker.current?.getElement();
    if (element) { element.hidden = !position; element.dataset.at = String(at); }
    if (position && marker.current && element) {
      marker.current.setLngLat([position.lon, position.lat]).setRotation(position.heading);
      element.dataset.lon = String(position.lon); element.dataset.lat = String(position.lat); element.dataset.heading = String(position.heading);
    }
  }, [at, loaded, points]);
  return <div className="trajectory-map" data-testid="trajectory-map" data-loaded={loaded && !failed}>
    <div className="map-canvas" ref={container} role="region" aria-label="Interactive synthetic voyage map"/>
    <div className="map-location"><span>NORTH SEA</span><small>Rotterdam approach · schematic coastline</small></div>
    <div className="map-key"><span>━ Past AIS</span><span>┄ Future AIS</span><span className="map-gap-key">┄ Uncertain gap</span></div>
    <div className="map-disclosure">Synthetic AIS · illustrative geography · MapLibre</div>
    {failed && <div className="map-fallback" role="status">Map unavailable. Use the timeline and AIS table below.</div>}
  </div>;
}

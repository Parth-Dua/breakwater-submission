"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import type { DocumentView, TimelineBand, TimelineView } from "../../../convex/room";

const COLORS: Record<string, string> = { LAYTIME: "#CBD5E1", DEMURRAGE: "#F5B544", Shifting: "#F7DFC5", Underway: "#CBD5E1", Anchored: "#DCE4ED", Berthed: "#BBCADB", Drifting: "#E4E7EC", Gap: "#F2F4F7", OPEN: "#F2F4F7", LOCKED: "#E4E7EC" };
export function Timeline({ data, cursor, onCursor, onDocument }: { data: TimelineView | null | undefined; cursor: number | null; onCursor: (at: number | null) => void; onDocument: (document: DocumentView, quote?: string) => void }) {
  const root = useRef<HTMLDivElement>(null), [width, setWidth] = useState(900);
  useEffect(() => { if (!root.current) return; const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); observer.observe(root.current); return () => observer.disconnect(); }, []);
  const left = 76, right = width - 16, range = data ? Math.max(1, data.endAt - data.startAt) : 1;
  const x = (at: number) => left + Math.max(0, Math.min(1, (at - (data?.startAt ?? 0)) / range)) * (right - left);
  const setAt = (at: number) => { if (data) onCursor(Math.max(data.startAt, Math.min(data.simNow, at))); };
  const band = (band: TimelineBand, index: number) => {
    const from = x(band.from), to = x(band.to), fill = band.treatment === "HALF" ? "url(#bw-half)" : band.treatment === "EXCLUDE" || band.treatment === "UNVERIFIED" ? "url(#bw-exclude)" : COLORS[band.kind] ?? "#E4E7EC";
    return <g key={index}><rect x={from} y={3} width={Math.max(1, to - from)} height={18} rx={2} fill={fill} stroke={band.kind === "Gap" ? "#98A2B3" : "none"} strokeDasharray={band.kind === "Gap" ? "3 3" : undefined}><title>{band.label} · {formatTime(band.from)}–{formatTime(band.to)}{band.treatment ? ` · ${band.treatment.toLowerCase()}` : ""}{band.clause ? ` · cl. ${band.clause}` : ""}</title></rect>{to - from >= 48 && <text x={(from + to) / 2} y={16} textAnchor="middle" fontSize={12} fill="#475467" pointerEvents="none">{(band.label.length > 20 ? band.kind.replaceAll("_", " ").toLowerCase() : band.label).slice(0, Math.max(3, Math.floor((to - from - 8) / 6)))}</text>}</g>;
  };
  return <div ref={root} tabIndex={0} role="region" aria-label="Timeline" data-testid="case-timeline" data-view-at={cursor ?? data?.simNow} className="relative h-full min-h-0 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface" onKeyDown={event => {
    if (!data) return;
    if (event.key === "Escape") { event.preventDefault(); onCursor(null); }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setAt((cursor ?? data.simNow) + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 6 : 1) * 3_600_000); }
  }}>
    <svg width="100%" height="168" viewBox={`0 0 ${width} 168`} aria-label="AIS, charter, sale, documents and periods">
      <defs><pattern id="bw-exclude" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#F2F4F7" /><path d="M-1,1 L1,-1 M0,6 L6,0 M5,7 L7,5" stroke="#98A2B3" strokeWidth="1" /></pattern><pattern id="bw-half" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#F5B544" fillOpacity=".3" /><circle cx="3" cy="3" r=".8" fill="#98A2B3" /></pattern></defs>
      {(data?.lanes ?? ["AIS", "Charter", "Sale", "Docs", "Period"].map(name => ({ name, bands: [] }))).map((lane, i) => <g key={lane.name} transform={`translate(0 ${i * 24})`}><text x={12} y={16} fontSize={12} fill="#475467">{lane.name}</text><line x1={left} x2={right} y1={23.5} y2={23.5} stroke="#E4E7EC" />{lane.bands.map(band)}{lane.name === "Docs" && data?.docs.map((pin, index) => <g key={`${pin.document.code}:${index}`} tabIndex={0} role="button" aria-label={`Open ${pin.document.title}`} className="cursor-pointer" onClick={() => onDocument(pin.document, pin.quote)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onDocument(pin.document, pin.quote); } }}><title>{pin.document.title} · {formatTime(pin.at)}</title><rect x={x(pin.at) - 7} y={0} width={28} height={24} fill="transparent" pointerEvents="all" /><path d={`M${x(pin.at)},3 l5,7 -5,7 -5,-7z`} fill="#1D4ED8" /><text x={x(pin.at) + 8} y={14} fontSize={12} fill="#475467">{pin.label}</text></g>)}</g>)}
      {data && <><rect x={left} y={120} width={right - left} height={48} fill="transparent" role="button" aria-label="Set view cursor" onClick={event => { const box = event.currentTarget.ownerSVGElement!.getBoundingClientRect(); setAt(data.startAt + Math.max(0, Math.min(1, (event.clientX - box.left - left) / (right - left))) * range); }} />{Array.from({ length: 5 }, (_, i) => { const at = data.startAt + range * i / 4; return <g key={i}><line x1={x(at)} x2={x(at)} y1={121} y2={126} stroke="#98A2B3" /><text x={x(at)} y={142} fontSize={12} fontFamily="IBM Plex Mono, monospace" textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fill="#475467">{formatTime(at)}</text></g>; })}<g className={cursor === null ? "transition-transform duration-[1200ms] ease-in-out" : ""} style={{ transform: `translateX(${x(data.simNow)}px)` }}><line y1={0} y2={121} stroke="#1D4ED8" strokeWidth={1.5} /><path d="M-4,0 L4,0 L0,6z" fill="#1D4ED8" /></g>{cursor !== null && <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={122} stroke="#0B1F3A" strokeDasharray="3 2" />}</>}
    </svg>
    <div className="absolute bottom-1 right-2 flex items-center gap-2 bg-surface px-1"><span className="font-mono text-[12px] text-ink-2">{cursor !== null ? formatTime(cursor) : ""}</span><Button size="sm" variant="ghost" className="h-5 px-2" aria-pressed={cursor === null} onClick={() => onCursor(null)}>Live</Button></div>
  </div>;
}

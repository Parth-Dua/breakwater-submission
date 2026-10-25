"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { aisGaps, overlapMinutes, positionAt, type TimeWindow } from "@/lib/trajectory";
import { formatUtc } from "@/lib/format";
import { Timeline, type TimelineBand } from "./Timeline";
import { ReconciliationPanel } from "../claims/ReconciliationPanel";
import { EvidencePanel } from "../claims/EvidencePanel";
import { InvestigationTrace } from "../claims/InvestigationTrace";
import { LoadingState } from "@/components/ui/states";
const TrajectoryMap = dynamic(() => import("./TrajectoryMap"), { ssr: false, loading: () => <div className="map-loading">Loading interactive map…</div> });
type Detail = NonNullable<FunctionReturnType<typeof api.claims.getDetail>>;
function subscribeMotion(callback: () => void) { const media = matchMedia("(prefers-reduced-motion: reduce)"); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); }

export function TimeMachine({ detail }: { detail: Detail }) {
  const timeline = useQuery(api.voyages.getTimeline, { voyageCode: detail.voyage.voyageCode });
  if (timeline === undefined) return <LoadingState/>;
  if (!timeline?.aisPoints.length) return <p className="quiet-state">No AIS observations available for this voyage.</p>;
  return <TimeMachinePlayback key={detail.voyage._id} detail={detail} points={timeline.aisPoints}/>;
}
function TimeMachinePlayback({ detail, points }: { detail: Detail; points: NonNullable<FunctionReturnType<typeof api.voyages.getTimeline>>["aisPoints"] }) {
  const [at, setAt] = useState(detail.voyage.startAt), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [selection, setSelection] = useState<TimeWindow | null>(null);
  const playhead = useRef(at), root = useRef<HTMLDivElement>(null);
  const reduced = useSyncExternalStore(subscribeMotion, () => matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
  const min = points[0].at, max = points[points.length - 1].at, gaps = useMemo(() => aisGaps(points), [points]);
  const active = detail.intervals.find(interval => at >= interval.startAt && at < interval.endAt), position = positionAt(points, at);
  const activePortSource = active?.evidenceIds.some(id => detail.evidence.some(source => source._id === id && source.type === "PORT_NOTICE"));
  const claimedMinutes = selection ? overlapMinutes(selection, [detail.voyage]) : 0;
  const evidencedMinutes = selection ? overlapMinutes(selection, detail.intervals.filter(interval => interval.treatment !== "UNVERIFIED")) : 0;
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)"), stop = () => { if (media.matches) setPlaying(false); };
    media.addEventListener("change", stop); return () => media.removeEventListener("change", stop);
  }, []);
  useEffect(() => {
    if (!playing || reduced) return;
    const start = performance.now(), from = playhead.current; let frame = 0, lastPaint = 0;
    function tick(now: number) {
      if (now - lastPaint >= 80) {
        const next = Math.min(max, from + Math.floor((now - start) * 900 * speed / 60_000) * 60_000);
        playhead.current = next; setAt(next); lastPaint = now;
        if (next === max) { setPlaying(false); return; }
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, reduced, speed, max]);
  useEffect(() => {
    if (!selection) return;
    const element = root.current;
    const timeout = setTimeout(() => element?.dispatchEvent(new CustomEvent("breakwater:range-selected", { bubbles: true, detail: { voyageId: detail.voyage._id, ...selection, claimedMinutes, evidencedMinutes } })), 350);
    return () => clearTimeout(timeout);
  }, [selection, claimedMinutes, evidencedMinutes, detail.voyage._id]);
  function jump(next: number) { setPlaying(false); const value = Math.max(min, Math.min(max, next)); playhead.current = value; setAt(value); }
  function toggle() { if (reduced) return; if (playhead.current >= max) { playhead.current = min; setAt(min); } setPlaying(value => !value); }
  const bands: TimelineBand[] = [
    { ...detail.voyage, label: "Invoice claim", tone: "invoice" },
    ...detail.evidence.filter(source => source.type !== "INVOICE").map(source => ({ startAt: source.startAt, endAt: source.endAt, label: source.type === "PORT_NOTICE" ? "Port notice" : source.type === "SIGNED_OPS_LOG" ? "Operations log" : "Exception", tone: source.signedStatus === "UNSIGNED" || source.withdrawnAt !== undefined ? "unknown" : "source" })),
    ...(!detail.evidence.some(source => source.type === "SIGNED_OPS_LOG") ? [{ startAt: detail.voyage.startAt, endAt: detail.voyage.startAt, label: "Ops log · none linked", tone: "unknown" }] : []),
    ...detail.intervals.filter(interval => interval.treatment === "UNVERIFIED").map(interval => ({ ...interval, label: "Cause unverified", tone: "unknown" })),
    ...gaps.map(gap => ({ ...gap, label: "AIS gap", tone: "gap" })),
  ];
  return <div ref={root} className="investigation-workspace">{detail.conflicts.length>0&&<p className="source-conflict-notice" role="status">Conflicting signed sources overlap {detail.conflicts.length} interval(s). Cause and financial treatment remain unverified until review.</p>}<div className="investigation-columns"><div className="voyage-pane">
    <div className="section-caption"><span>VESSEL TIME MACHINE</span><small>{points.length} synthetic AIS observations</small></div>
    <TrajectoryMap points={points} at={at}/>
    <div className="playhead-status"><time data-testid="playhead-time" dateTime={new Date(at).toISOString()}>{formatUtc(at)}</time><span className={position ? "" : "unverified-text"} data-testid="position-status">{position ? `${position.lat.toFixed(4)}° N · ${position.lon.toFixed(4)}° E · ${Math.round(position.heading)}°` : "Position unknown — AIS gap"}</span></div>
    <div className={`current-evidence current-${active?.treatment.toLowerCase() ?? "outside"}`} data-testid="active-evidence"><span>{active?.treatment === "SUPPORTED" ? activePortSource ? "PORT NOTICE VERIFIED" : "OPERATIONS SOURCE VERIFIED" : active?.treatment === "DISPUTED" ? "EXCLUDED UNDER EFFECTIVE CHARTER" : active ? "OPERATIONAL CAUSE UNVERIFIED" : "OUTSIDE INVOICE INTERVAL"}</span><p>{active?.treatment === "SUPPORTED" ? "Verified source covers this interval. AIS provides location context only." : active ? "Movement alone cannot establish cause or contractual treatment." : "Scrub into the claim to review source coverage."}</p></div>
    {!position && <p className="ais-gap-notice" role="status">No reliable position between adjacent observations. Vessel marker hidden; movement is not interpolated across this gap.</p>}
    <Timeline min={min} max={max} at={at} playing={playing && !reduced} speed={speed} reduced={reduced} bands={bands} selection={selection} onAt={jump} onToggle={toggle} onSpeed={setSpeed} onSelect={setSelection} onNext={() => { const starts = detail.evidence.map(source => source.startAt).sort((a, b) => a - b); jump(starts.find(start => start > at) ?? starts[0] ?? min); }}/>
    {selection && <output className="selection-summary" data-testid="selection-summary">Selected {formatUtc(selection.startAt)} — {formatUtc(selection.endAt)}<strong>{claimedMinutes} claimed minutes · {evidencedMinutes} evidenced minutes</strong></output>}
    <details className="ais-table"><summary>AIS observations · accessible table</summary><div className="table-scroll"><table><thead><tr><th>UTC timestamp</th><th>Latitude</th><th>Longitude</th><th>Heading</th><th>Quality</th></tr></thead><tbody>{points.map(point => <tr key={point._id}><td>{formatUtc(point.at)}</td><td>{point.lat.toFixed(4)}</td><td>{point.lon.toFixed(4)}</td><td>{point.heading}°</td><td>{point.quality.replaceAll("_", " ")}</td></tr>)}</tbody></table></div></details>
    <InvestigationTrace claimId={detail.claim._id} revision={detail.claim.revision}/>
  </div><aside className="claim-inspector"><ReconciliationPanel calculation={detail.calculation} charter={detail.charter} claim={detail.claim} active={active}/><EvidencePanel evidence={detail.evidence} at={at} onJump={jump}/></aside></div></div>;
}

"use client";
import type { KeyboardEvent } from "react";
import { Pause, Play, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUtc } from "@/lib/format";
import type { TimeWindow } from "@/lib/trajectory";
export type TimelineBand = TimeWindow & { label: string; tone: string };
export function Timeline({ min, max, at, playing, speed, reduced, bands, selection, onAt, onToggle, onSpeed, onSelect, onNext }: {
  min: number; max: number; at: number; playing: boolean; speed: number; reduced: boolean; bands: TimelineBand[]; selection: TimeWindow | null;
  onAt: (at: number) => void; onToggle: () => void; onSpeed: (speed: number) => void; onSelect: (range: TimeWindow | null) => void; onNext: () => void;
}) {
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); onSelect(null); }
    if (event.target !== event.currentTarget && !(event.target instanceof HTMLInputElement && event.target.id === "voyage-playhead")) return;
    if (event.key === " ") { event.preventDefault(); onToggle(); }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); onAt(Math.max(min, Math.min(max, at + (event.key === "ArrowRight" ? 1 : -1) * 60_000))); }
  }
  const windowStyle = (range: TimeWindow) => ({ left: `${Math.max(0, (range.startAt - min) / (max - min) * 100)}%`, width: `${(Math.min(max, range.endAt) - Math.max(min, range.startAt)) / (max - min) * 100}%` });
  return <div className="voyage-timeline" tabIndex={0} aria-label="Voyage timeline controls" onKeyDown={keyboard}>
    <div className="playback-controls"><Button size="icon" aria-label={playing ? "Pause voyage" : "Play voyage"} disabled={reduced} onClick={onToggle}>{playing ? <Pause size={15}/> : <Play size={15}/>}</Button><select aria-label="Playback speed" value={speed} onChange={event => onSpeed(Number(event.target.value))}>{[1, 4, 16].map(value => <option value={value} key={value}>{value}x</option>)}</select><Button variant="ghost" onClick={onNext}><SkipForward size={14}/> Next evidence</Button><small>1x = 15 voyage min / sec</small></div>
    <label className="sr-only" htmlFor="voyage-playhead">Timeline playhead</label><input id="voyage-playhead" type="range" min={min} max={max} step={60_000} value={at} aria-valuetext={formatUtc(at)} onChange={event => onAt(Number(event.target.value))}/>
    <div className="time-ruler"><span>{formatUtc(min)}</span><span>{formatUtc(max)}</span></div>
    <div className="timeline-bands">{bands.map((band, index) => <div className="timeline-band" key={`${band.label}-${index}`}><span>{band.label}</span><div className="band-track"><div style={windowStyle(band)} className={`band-window band-${band.tone}`} title={`${formatUtc(band.startAt)} — ${formatUtc(band.endAt)}`}/><i className="band-playhead" style={{ left: `${(at - min) / (max - min) * 100}%` }}/></div></div>)}</div>
    <details className="range-selection" open={selection ? true : undefined}><summary>Select time range</summary><div><label>Range start<input type="range" aria-label="Range start" min={min} max={max - 60_000} step={60_000} value={selection?.startAt ?? min} onChange={event => { const startAt = Number(event.target.value); onSelect({ startAt, endAt: Math.max(startAt + 60_000, selection?.endAt ?? max) }); }}/></label><label>Range end<input type="range" aria-label="Range end" min={min + 60_000} max={max} step={60_000} value={selection?.endAt ?? max} onChange={event => { const endAt = Number(event.target.value); onSelect({ startAt: Math.min(endAt - 60_000, selection?.startAt ?? min), endAt }); }}/></label></div>{selection && <Button variant="ghost" onClick={() => onSelect(null)}>Clear selection</Button>}</details>
    <p className="timeline-help">Arrows: one minute · Space: play/pause · Escape: clear selection{reduced ? " · Reduced motion: use scrub controls; animation disabled." : ""}</p>
  </div>;
}

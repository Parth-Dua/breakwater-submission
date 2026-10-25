"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatUtc } from "@/lib/format";
export function FindingForm({ sessionId, work, evidence }: { sessionId: Id<"workSessions">; work: Doc<"workItems">; evidence: Doc<"evidence">[] }) {
  const save = useMutation(api.workItems.saveFinding), submit = useMutation(api.workItems.submitFinding), clarify = useMutation(api.workItems.requestClarification), reassign = useMutation(api.workItems.reassign);
  const [cause, setCause] = useState<NonNullable<Doc<"workItems">["finding"]>["cause"]>(work.finding?.cause ?? "UNKNOWN"), [note, setNote] = useState(work.finding?.note ?? ""), [unavailable, setUnavailable] = useState(false), [selectedIds, setSelectedIds] = useState<Id<"evidence">[]>(work.finding?.evidenceIds ?? []), [pending, setPending] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const windows = work.affectedIntervals ?? [], startAt = windows[0]?.startAt, endAt = windows[windows.length - 1]?.endAt;
  const sources = evidence.filter(source => source.type === "SIGNED_OPS_LOG"), value = { cause: unavailable ? "UNKNOWN" as const : cause, startAt, endAt, evidenceIds: unavailable ? [] : selectedIds, note: note.trim(), unavailable };
  async function perform(action: "SAVE" | "SUBMIT" | "CLARIFY" | "RETURN") {
    setPending(true); setError(""); setSaved(false);
    try { if (action === "CLARIFY") await clarify({ sessionId, note }); else if (action === "RETURN") await reassign({ sessionId }); else if (startAt !== undefined && endAt !== undefined) { const finding = { ...value, startAt, endAt }; if (action === "SAVE") { await save({ sessionId, finding }); setSaved(true); } else await submit({ sessionId, finding }); } }
    catch { setError("Review could not be saved. Select linked signed evidence matching the cause and complete interval, and include a finding note. The session must still be assigned to you."); } finally { setPending(false); }
  }
  return <section className="work-panel finding-panel"><div className="work-panel-heading"><h2>Your finding</h2><p>State what the source establishes. Contractual treatment is calculated separately.</p></div><p className="finding-interval">{startAt !== undefined && endAt !== undefined ? `${formatUtc(startAt)} — ${formatUtc(endAt)}` : "No interval requested"}</p>
    <label htmlFor="finding-cause">Operational cause</label><select id="finding-cause" value={cause} disabled={unavailable} onChange={event => { setCause(event.target.value as typeof cause); setSaved(false); }}>{["UNKNOWN", "CUSTOMS", "BERTH", "WEATHER", "PORT_CLOSURE"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select>
    <fieldset disabled={unavailable}><legend>Source references · linked for this review</legend>{!sources.length && <p className="muted">Search, compare, and link an Operations log to make it available here.</p>}{sources.map(source => <label className="checkbox-label" key={source._id}><input type="checkbox" checked={selectedIds.includes(source._id)} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, source._id] : ids.filter(id => id !== source._id))}/>{source.evidenceCode}</label>)}</fieldset>
    <label className="checkbox-label"><input type="checkbox" checked={unavailable} onChange={event => setUnavailable(event.target.checked)}/>Evidence unavailable — keep cause unverified</label>
    <label htmlFor="finding-note">Finding note or clarification question</label><textarea id="finding-note" value={note} maxLength={2000} rows={4} onChange={event => { setNote(event.target.value); setSaved(false); }} placeholder="Describe the source-backed finding, or explain what information is missing."/>
    {error && <p className="form-error" role="alert">{error}</p>}{saved && <p className="verified-text" role="status">Draft saved. It has not been submitted as a final finding.</p>}
    <div className="finding-actions"><Button disabled={pending} onClick={() => void perform("SAVE")}>{work.finding ? "Save correction" : "Save finding draft"}</Button><Button variant="primary" disabled={pending || startAt === undefined} onClick={() => void perform("SUBMIT")}>{unavailable ? "Submit unavailable evidence" : "Submit finding"}</Button></div><div className="finding-secondary"><Button variant="ghost" disabled={pending} onClick={() => void perform("CLARIFY")}>Request clarification</Button><Button variant="ghost" disabled={pending} onClick={() => void perform("RETURN")}>Return to Operations queue</Button></div>
  </section>;
}

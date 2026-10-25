"use client";
import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { Search, Link as LinkIcon, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { DocumentView } from "../../../convex/room";
import type { EvidenceRef } from "@/domain/laytime";
import { canonicalJson } from "@/domain/canonical";
import { Button } from "@/components/ui/button";
import { EmptyLine, InlineError } from "@/components/ui/feedback";
import { DocumentViewer } from "../room/DocumentViewer";
import { formatDate } from "@/lib/format";
import { automation, useStartWork, type WorkSurface } from "./useWork";

type System = "MAILBOX" | "CUSTOMS_PORTAL" | "DOC_STORE";
type Cause = "WEATHER" | "PORT_CLOSURE" | "SHIFTING" | "OPERATIONS";
const SOURCES: { id: System; label: string }[] = [{ id: "MAILBOX", label: "Mailbox" }, { id: "CUSTOMS_PORTAL", label: "Customs portal" }, { id: "DOC_STORE", label: "Documents" }];
const inputClass = "h-8 min-w-0 rounded border border-border bg-surface px-2 text-[12px]";
export function OpsDesk({ caseCode, work }: { caseCode: string; work: WorkSurface }) {
  useStartWork(work.code);
  const search = useMutation(api.sources.search), open = useMutation(api.sources.openDocument), link = useMutation(api.asks.linkEvidence), unlink = useMutation(api.asks.unlinkEvidence), answer = useMutation(api.asks.answer);
  const [system, setSystem] = useState<System>("MAILBOX"), [query, setQuery] = useState(work.vessel), [results, setResults] = useState<FunctionReturnType<typeof api.sources.search> | null>(null), [document, setDocument] = useState<DocumentView | null>(null);
  const [option, setOption] = useState("CONFIRM"), [reason, setReason] = useState(""), [cause, setCause] = useState<Cause>("OPERATIONS"), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function act(action: () => Promise<unknown>, message: string) { setBusy(true); setError(null); try { await action(); } catch { setError(message); } finally { setBusy(false); } }
  async function find(event: FormEvent) { event.preventDefault(); await act(async () => setResults(await search({ caseCode, system, query, ...automation() })), "Could not search sources"); }
  const selectedEvidence: EvidenceRef | null = document ? { kind: "DOC", documentId: document.code } : null;
  const isLinked = selectedEvidence && work.linked.some(ref => canonicalJson(ref) === canonicalJson(selectedEvidence));
  async function submit() { await act(() => answer({ askCode: work.code, answer: { optionId: option, evidence: work.linked, ...(option === "DIFFERENT" ? { reason, causeKind: cause } : {}) }, ...automation() }), option === "CONFIRM" ? "Link a release covering this vessel and hold" : "Could not submit this answer"); }
  return <div className="flex h-full min-h-0 flex-col" data-testid="ops-desk"><div className="border-b border-border px-4 py-3 text-[14px] font-medium">{work.question}</div>
    <div className="grid min-h-0 flex-1 grid-cols-[120px_210px_minmax(0,1fr)]"><nav className="space-y-1 border-r border-border p-2" aria-label="Sources">{SOURCES.map(source => <button key={source.id} className={`w-full rounded px-2 py-2 text-left text-[12px] ${source.id === system ? "bg-[#EFF4FF] text-agent" : "text-ink-2 hover:bg-surface-2"}`} aria-pressed={source.id === system} onClick={() => { setSystem(source.id); setResults(null); setDocument(null); }}>{source.label}</button>)}</nav>
      <section className="flex min-h-0 flex-col border-r border-border"><form onSubmit={event => void find(event)} className="flex gap-1 border-b border-border p-2"><input aria-label="Search sources" className={`${inputClass} flex-1`} value={query} maxLength={160} onChange={event => setQuery(event.target.value)} /><Button type="submit" size="icon" variant="ghost" aria-label="Search" disabled={busy || !query.trim()}><Search size={14} /></Button></form><div className="min-h-0 flex-1 overflow-auto">{results === null ? <EmptyLine>Sources</EmptyLine> : results.length === 0 ? <EmptyLine>No results</EmptyLine> : results.map(result => <button key={result.code} type="button" className={`w-full border-b border-border p-3 text-left hover:bg-surface-2 ${document?.code === result.code ? "bg-surface-2" : ""}`} onClick={() => void act(async () => setDocument(await open({ caseCode, documentCode: result.code, ...automation() })), "Could not open document")}><span className="block text-[12px] font-medium">{result.title}</span>{result.receivedAt !== null && <span className="mt-1 block font-mono text-[11px] text-ink-2">{formatDate(result.receivedAt)}</span>}</button>)}</div></section>
      <section className="flex min-h-0 min-w-0 flex-col">{document ? <><div className="min-h-0 flex-1"><DocumentViewer key={document.code} document={document} onBack={() => setDocument(null)} /></div><div className="flex justify-end border-t border-border p-2"><Button size="sm" variant="outline" disabled={busy || !!isLinked} onClick={() => selectedEvidence && void act(() => link({ askCode: work.code, evidence: selectedEvidence, ...automation() }), "Could not link evidence")}><LinkIcon size={12} />{isLinked ? "Linked" : "Link to hold"}</Button></div></> : <EmptyLine>No document open</EmptyLine>}</section>
    </div>
    <div className="space-y-2 border-t border-border p-3"><div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2"><span>Linked:</span>{work.linked.map((ref, i) => <button key={JSON.stringify(ref)} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1" onClick={() => void act(() => unlink({ askCode: work.code, evidence: ref, ...automation() }), "Could not unlink evidence")} aria-label={`Unlink ${work.linkedViews[i]?.label ?? "document"}`}>{work.linkedViews[i]?.label ?? "Document"}<X size={12} /></button>)}{!work.linked.length && "—"}</div>
      <div className="flex flex-wrap items-center gap-3 text-[12px]">{work.options.map(choice => <label key={choice.id} className="inline-flex items-center gap-1.5"><input type="radio" name="ops-answer" value={choice.id} checked={choice.id === option} onChange={() => setOption(choice.id)} />{choice.label}</label>)}<Button size="sm" variant="primary" className="ml-auto" disabled={busy || option !== "CANT_FIND" && !work.linked.length || option === "DIFFERENT" && !reason.trim()} onClick={() => void submit()}>Submit</Button></div>
      {option === "DIFFERENT" && <div className="flex gap-2"><select aria-label="Different cause" className={inputClass} value={cause} onChange={event => setCause(event.target.value as Cause)}><option value="OPERATIONS">Operations</option><option value="WEATHER">Weather</option><option value="PORT_CLOSURE">Port closure</option><option value="SHIFTING">Shifting</option></select><input aria-label="Cause reason" className={`${inputClass} flex-1`} value={reason} maxLength={240} placeholder="Reason" onChange={event => setReason(event.target.value)} /></div>}{error && <InlineError message={error} />}
    </div>
  </div>;
}

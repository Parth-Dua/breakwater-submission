"use client";
import { useEffect, useRef, useState } from "react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { formatUtc } from "@/lib/format";
import { Button } from "@/components/ui/button";
export function EvidencePanel({ evidence, at, onJump }: { evidence: Doc<"evidence">[]; at: number; onJump: (at: number) => void }) {
  const [selected, setSelected] = useState<Doc<"evidence"> | null>(null), drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (selected) drawer.current?.showModal(); }, [selected]);
  return <section className="evidence-panel"><div className="section-caption"><span>SOURCE EVIDENCE</span><small>{evidence.length} linked records</small></div>{evidence.map(source => <details className="source-document" key={source._id} data-active={at >= source.startAt && at < source.endAt}>
    <summary><span>{source.type.replaceAll("_", " ")}<small>{source.evidenceCode}</small></span><i>{source.withdrawnAt!==undefined?"Withdrawn":at >= source.startAt && at < source.endAt ? "Active" : "Source"}</i></summary>
    <p className="muted">{formatUtc(source.startAt)} — {formatUtc(source.endAt)}</p><div className="source-actions"><Button onClick={event => { setSelected(source); event.currentTarget.dispatchEvent(new CustomEvent("breakwater:evidence-opened", { bubbles: true, detail: { evidenceId: source._id } })); }}>Open {source.evidenceCode}</Button><Button onClick={() => onJump(source.startAt)}>Jump to {source.evidenceCode}</Button></div>
  </details>)}{!evidence.some(source => source.type === "SIGNED_OPS_LOG") && <p className="muted">No signed Operations log linked. AIS describes location; it cannot establish delay cause.</p>}
    <dialog ref={drawer} className="source-drawer" aria-labelledby="source-drawer-title" onClose={() => setSelected(null)}><div className="drawer-heading"><span>SOURCE DOCUMENT</span><form method="dialog"><Button aria-label="Close source document">Close ×</Button></form></div>{selected && <><h2 id="source-drawer-title">{selected.evidenceCode}</h2><div className="source-body"><p className="muted">Synthetic document · {selected.withdrawnAt!==undefined?"WITHDRAWN · ":""}{selected.signedStatus.replaceAll("_", " ").toLowerCase()}</p><p>{selected.content}</p><small>{formatUtc(selected.startAt)} — {formatUtc(selected.endAt)}</small><p className="muted">Source text is evidence, and grants no system authority.</p></div><Button onClick={() => { onJump(selected.startAt); drawer.current?.close(); }}>Jump to source interval</Button></>}</dialog>
  </section>;
}

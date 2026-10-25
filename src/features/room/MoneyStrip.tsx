"use client";
import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Check, Hourglass, List } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { EvidenceView, RoomMoney } from "../../../convex/room";
import { Money } from "@/components/ui/money";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton, EmptyLine } from "@/components/ui/feedback";
import { formatTime } from "@/lib/format";
import { EvidenceLinks } from "./EvidenceLinks";

type Explanation = { text: string; citations: EvidenceView[] };
export function MoneyStrip({ caseCode, data, onEvidence }: { caseCode: string; data: RoomMoney | null | undefined; onEvidence: (evidence: EvidenceView) => void }) {
  const why = useAction(api.explain.why), [answers, setAnswers] = useState<Record<string, Explanation>>({}), [failed, setFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const journals = useQuery(api.books.journals, sheetOpen ? { filter: "ALL" } : "skip");
  const fields = [{ key: "BILLED", label: "Billed", cents: data?.billedCents }, { key: "PAYABLE", label: "We owe", cents: data?.oweCents }, { key: "RECOVERABLE", label: "Recover", cents: data?.recoverCents }, { key: "NET", label: "Net", cents: data?.netCents }, { key: "TIME_BAR", label: "Time bar", cents: null }];
  async function explain(field: string) { const key = `${caseCode}:${data?.version}:${field}`; if (answers[key]) return; setFailed(false); try { const answer = await why({ entityType: "CASE_TOTAL", entityId: caseCode, field }); setAnswers(values => ({ ...values, [key]: answer })); } catch { setFailed(true); } }
  return <div className="flex h-full min-w-[700px] items-stretch divide-x divide-border rounded-[var(--radius-panel)] border border-border bg-surface" aria-label="Money" data-testid="room-money">
    {fields.map(field => { const key = `${caseCode}:${data?.version}:${field.key}`, answer = answers[key]; return <Popover key={field.key} onOpenChange={open => { if (open) void explain(field.key); }}><PopoverTrigger asChild><button type="button" className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-4 text-left hover:bg-surface-2" aria-label={`Why ${field.label.toLowerCase()}?`}><span className="label">{field.label}</span><span className="flex items-baseline gap-2">{field.key === "TIME_BAR" ? <span className="flex items-center gap-1.5 text-[14px] text-ink-2">{data?.timeBar.filed ? <><Check size={14} className="text-pos" />Filed</> : data?.timeBar.days !== null && data?.timeBar.days !== undefined ? <><Hourglass size={14} className="text-warn" />{data.timeBar.days} d</> : "—"}</span> : <Money cents={field.cents} metric={`room:${caseCode}:${field.key}`} size="kpi" sign={field.key === "NET"} className={field.key === "NET" && (field.cents ?? 0) < 0 ? "text-neg" : ""} />}{field.key === "PAYABLE" && data?.oweCents !== null && data?.oweCents !== undefined && <span className="text-[11px] text-ink-2">{data.payableState}</span>}{field.key === "RECOVERABLE" && data?.recoverCents !== null && data?.recoverCents !== undefined && <span className="text-[11px] text-ink-2">{data.waivedCents > 0 ? <>waived <Money cents={data.waivedCents} metric={`room:${caseCode}:waived`} /></> : data.recoveryState}</span>}</span></button></PopoverTrigger><PopoverContent align="start"><h3 className="mb-2 text-[14px] font-semibold">Why?</h3>{answer ? <><div className="mb-3 text-[12px] leading-5 text-ink-2">{answer.text}</div><EvidenceLinks evidence={answer.citations} onEvidence={onEvidence} /></> : failed ? <span className="text-[12px] text-neg">Could not load evidence</span> : <div className="space-y-2"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" /></div>}</PopoverContent></Popover>; })}
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}><SheetTrigger asChild><Button variant="ghost" className="h-full shrink-0 rounded-none px-3 text-[12px]"><List size={14} />Journals</Button></SheetTrigger><SheetContent title="Journals">{!journals ? <Skeleton className="h-24 w-full" /> : !journals.some(entry => entry.caseCode === caseCode) ? <EmptyLine>No journals yet</EmptyLine> : <div className="space-y-4">{journals.filter(entry => entry.caseCode === caseCode).map(entry => <section key={entry.code} className="rounded border border-border p-3"><div className="mb-3 flex items-center gap-4 font-mono text-[12px]"><span>{formatTime(entry.at)}</span><span>{entry.period}</span><span>{entry.code}</span><span className="ml-auto font-sans text-ink-2">{entry.authority}</span></div>{entry.lines.map((line, i) => <div key={i} className="flex gap-3 py-1 text-[12px]"><span className="font-mono">{line.side === "DEBIT" ? "Dr" : "Cr"} {line.account}</span><span className="flex-1 text-ink-2">{line.counterparty ?? line.name}</span><Money cents={line.cents} metric={`journal:${entry.code}:line:${i}`} /></div>)}</section>)}</div>}</SheetContent></Sheet>
  </div>;
}

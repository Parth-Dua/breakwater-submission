"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { EvidenceView, StepView } from "../../../convex/room";
import { IconStatus } from "@/components/ui/icon-status";
import { DeltaChip, MemoryChip } from "@/components/ui/chip";
import { EmptyLine, Skeleton } from "@/components/ui/feedback";
import { EvidenceLinks } from "./EvidenceLinks";

function Details({ step, onEvidence, onMemory }: { step: StepView; onEvidence: (evidence: EvidenceView) => void; onMemory: (code: string) => void }) {
  return <div className="mt-3 space-y-2"><div className="space-y-1 text-[12px] leading-5 text-ink-2">{[step.observation, step.check, step.conclusion].filter(Boolean).map((line, index) => <div key={index} className="truncate" title={line}>{index === 2 ? "→ " : ""}{line}</div>)}</div>{step.evidence.length > 0 && <EvidenceLinks evidence={step.evidence} onEvidence={onEvidence} />}{step.tools.length > 0 && <div className="text-[11px] leading-5 text-ink-2">Tools used: {step.tools.join(" · ")}</div>}{step.memories.map(code => <MemoryChip key={code} label="Used memory" onClick={() => onMemory(code)} />)}</div>;
}
export function ThinkingFeed({ data, onEvidence, onMemory }: { data: { now: StepView | null; done: StepView[] } | undefined; onEvidence: (evidence: EvidenceView) => void; onMemory: (code: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!data) return <div className="space-y-3 p-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-8 w-full" /></div>;
  return <div data-testid="thinking-feed">{data.now && <section className="animate-step-in border-b border-border border-l-[3px] border-l-agent bg-[#1D4ED805] p-4" aria-label="Now" data-testid="now-card"><div className="mb-2 text-[10px] font-semibold tracking-wider text-agent">NOW</div><div className="flex items-start gap-2"><IconStatus kind="working" /><h2 className="min-w-0 flex-1 text-[14px] font-medium">{data.now.title}</h2>{data.now.deltaCents !== null && <DeltaChip cents={data.now.deltaCents} />}</div><Details step={data.now} onEvidence={onEvidence} onMemory={onMemory} /></section>}
    {!data.now && !data.done.length && <EmptyLine>No steps yet</EmptyLine>}
    <ul className="divide-y divide-border">{data.done.map(step => <li key={step.key} className="animate-step-in px-4 py-3"><button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setExpanded(expanded === step.key ? null : step.key)} aria-expanded={expanded === step.key}><IconStatus kind={step.status === "FAILED" ? "review" : step.status === "ASKED" ? "waiting" : "done"} size={14} /><span className="min-w-0 flex-1 text-[12px] leading-4">{step.title}</span>{step.deltaCents !== null && <DeltaChip cents={step.deltaCents} />}{expanded === step.key ? <ChevronDown size={12} className="shrink-0 text-ink-3" /> : <ChevronRight size={12} className="shrink-0 text-ink-3" />}</button>{expanded === step.key ? <Details step={step} onEvidence={onEvidence} onMemory={onMemory} /> : step.memories.length > 0 && <div className="mt-2"><MemoryChip label="Used memory" onClick={() => onMemory(step.memories[0])} /></div>}</li>)}</ul>
  </div>;
}

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { MemoryView } from "../../../convex/room";
import { MemoryDetail } from "./MemoryDetail";
import { Pill } from "@/components/ui/pill";
import { EmptyLine, Skeleton } from "@/components/ui/feedback";
import { formatDate } from "@/lib/format";

const STATUS: Record<string, string> = { PENDING_TEACHBACK: "Scope", PENDING_CONTROLLER: "Approval", PROPOSED: "Proposed", ACTIVE: "Active", PRECEDENT_ONLY: "Precedent", REJECTED: "Rejected", REVOKED: "Revoked", NEEDS_REVIEW: "Review" };
export function MemoryList({ rows, selected }: { rows: MemoryView[] | undefined; selected: string | null }) {
  const [expanded, setExpanded] = useState<string | null>(null), [wallNow, setWallNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setWallNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const current = expanded ?? selected;
  if (!rows) return <div className="space-y-3 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>;
  if (!rows.length) return <EmptyLine>No lessons yet</EmptyLine>;
  return <div data-testid="room-memory">{(["Learned here", "Used here", "Recent"] as const).map(group => {
    const items = rows.filter(row => row.group === group); if (!items.length) return null;
    return <section key={group}><h2 className="label border-b border-border px-4 py-3">{group}</h2><ul className="divide-y divide-border">{items.map(item => <li key={item.code} data-memory-code={item.code} data-memory-kind={item.kind} data-status={item.status} className="px-4 py-3"><button type="button" onClick={() => setExpanded(current === item.code ? "" : item.code)} aria-expanded={current === item.code} className="w-full text-left"><span className="flex items-start gap-2"><Sparkles size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-memory" /><span className={`min-w-0 flex-1 text-[12px] leading-5 ${item.status === "PRECEDENT_ONLY" ? "text-ink-3" : "text-ink"}`}>{item.title}</span>{item.newEligible && wallNow >= item.wallCreatedAt && wallNow - item.wallCreatedAt < 30_000 && <span className="animate-new text-[10px] font-semibold text-memory">NEW</span>}</span><span className="mt-2 flex items-center gap-1.5"><Pill tone="memory">{item.kind === "PROCEDURE" ? "Procedure" : item.kind === "FACT" ? "Fact" : "Precedent"}</Pill><Pill tone={item.status === "ACTIVE" ? "pos" : item.status === "PRECEDENT_ONLY" ? "neutral" : "warn"}>{STATUS[item.status] ?? "Pending"}</Pill></span>{item.from && <span className="mt-2 block text-[11px] text-ink-2">from {item.from} · {formatDate(item.at)}</span>}</button>{current === item.code && <div className="mt-3 space-y-3">{item.status === "PRECEDENT_ONLY" && <div className="text-[12px] text-ink-2">Not learned · commercial judgment</div>}{item.usedIn.length > 0 && <div className="flex flex-wrap items-center gap-1 text-[12px] text-ink-2"><span>Used in</span>{item.usedIn.map(use => <Link key={use.code} href={`/case/${use.code}`} className="rounded border border-border px-1.5 py-1 text-agent">{use.vessel}</Link>)}</div>}<MemoryDetail code={item.code} /></div>}</li>)}</ul></section>;
  })}</div>;
}

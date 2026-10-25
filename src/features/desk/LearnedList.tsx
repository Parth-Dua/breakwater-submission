import { Sparkles } from "lucide-react";
import type { MemoryRow } from "../../../convex/desk";
import { EmptyLine, Skeleton } from "@/components/ui/feedback";
import { Pill, type Tone } from "@/components/ui/pill";

const LABELS: Record<string, { label: string; tone: Tone }> = { ACTIVE: { label: "Active", tone: "pos" }, PRECEDENT_ONLY: { label: "Precedent", tone: "neutral" }, REJECTED: { label: "Rejected", tone: "neg" }, REVOKED: { label: "Revoked", tone: "neg" }, NEEDS_REVIEW: { label: "Review", tone: "warn" } };
export function LearnedList({ rows }: { rows: MemoryRow[] | undefined }) {
  return <section aria-label="Learned"><div className="border-y border-border px-4 py-3"><h2 className="section-title">Learned</h2></div>{!rows ? <div className="space-y-3 p-4"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div> : !rows.length ? <EmptyLine>No lessons yet</EmptyLine> : <ul className="divide-y divide-border">{rows.map(item => <li key={item.code} className="flex items-start gap-2 px-4 py-3"><Sparkles size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-memory" /><span className="min-w-0 flex-1 text-[12px] leading-5 text-ink-2">{item.title}</span><Pill tone={LABELS[item.status]?.tone ?? "warn"}>{LABELS[item.status]?.label ?? "Pending"}</Pill></li>)}</ul>}</section>;
}

import { Lock, Hourglass } from "lucide-react";
import type { DeskSummary, PeriodView } from "../../../convex/desk";
import { Money } from "@/components/ui/money";
import { Panel } from "@/components/shell/PageGrid";
import { Skeleton } from "@/components/ui/feedback";

export function Periods({ periods, compact = false }: { periods: PeriodView[]; compact?: boolean }) {
  const locked = periods.filter(period => period.status === "LOCKED"), last = locked.at(-1);
  const visible = compact ? [...(last ? [last] : []), ...periods.filter(period => period.status === "OPEN")] : periods;
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{visible.map(period => <span key={period.code} className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] text-ink-2" title={period.status === "LOCKED" ? "Locked" : "Open"}>{new Date(`${period.code}-01T00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}{period.status === "LOCKED" ? <Lock size={11} strokeWidth={1.75} aria-label="Locked" /> : <span className="h-1 w-1 rounded-full bg-pos" aria-label="Open" />}</span>)}</div>;
}

export function KpiStrip({ summary }: { summary: DeskSummary | undefined }) {
  const values = summary ? [summary.kpis.oweCents, summary.kpis.recoverableCents, summary.kpis.netCents] : [];
  return <Panel className="grid h-full min-w-[700px] grid-cols-[1fr_1fr_1fr_.85fr_1.5fr] divide-x divide-border" aria-label="Company">
    {["We owe", "Recoverable", "Net this Q"].map((label, index) => <div key={label} className="flex flex-col justify-center gap-1 px-4"><span className="label">{label}</span>{summary ? <Money metric={`desk:${index}`} cents={values[index]} size="kpi" sign={index === 2} className={index === 2 ? values[index] < 0 ? "text-neg" : "text-pos" : ""} /> : <Skeleton className="h-7 w-28" />}</div>)}
    <div className="flex flex-col justify-center gap-1 px-4"><span className="label">Time bars</span>{summary ? <span className={`flex items-center gap-2 text-[22px] font-semibold tabular ${summary.kpis.timeBars ? "text-warn" : "text-ink"}`}>{summary.kpis.timeBars}<Hourglass size={16} strokeWidth={1.75} /><span className="text-[12px] font-normal text-ink-2">&lt; 7 days</span></span> : <Skeleton className="h-7 w-20" />}</div>
    <div className="flex flex-col justify-center gap-2 px-4"><span className="label">Periods</span>{summary ? <Periods periods={summary.periods} compact /> : <Skeleton className="h-4 w-full" />}</div>
  </Panel>;
}

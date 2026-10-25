import { Sparkles } from "lucide-react";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const base = "inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-[12px] leading-none";

/** Evidence reference (document, AIS window, clause). Clicking jumps to the source. */
export function EvidenceChip({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(base, "border border-border bg-surface font-mono text-ink-2 hover:border-agent hover:text-agent")}>
      {label}
    </button>
  );
}

/** "✦ Used memory · …" */
export function MemoryChip({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(base, "bg-[#F4F3FF] text-memory hover:bg-[#EBE9FE]")}>
      <Sparkles size={12} strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}

/** Money delta: negative = neg tone, positive = warn tone (UI §1.5). */
export function DeltaChip({ cents }: { cents: number }) {
  if (cents === 0) return null;
  return <span className={cn(base, "tabular font-medium", cents < 0 ? "bg-[#FEF3F2] text-neg" : "bg-[#FFFAEB] text-warn")}>{formatUsd(cents, { sign: true })}</span>;
}

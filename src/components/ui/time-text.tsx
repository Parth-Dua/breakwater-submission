import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Sim time as "30 Oct 12:00" (no "UTC": it appears once, in the clock). */
export function TimeText({ at, className }: { at: number; className?: string }) {
  return <time dateTime={new Date(at).toISOString()} className={cn("font-mono text-[12px] leading-4 text-ink-2", className)}>{formatTime(at)}</time>;
}

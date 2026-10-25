import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Formats backend cents. Never computes money (UI principle; REQ-AGT-03). */
export function Money({ cents, size = "table", sign, className, metric }: { cents: number | null | undefined; size?: "kpi" | "table"; sign?: boolean; className?: string; metric?: string }) {
  return (
    <span data-money-metric={metric} className={cn("tabular", size === "kpi" ? "text-[22px] font-semibold leading-7" : "text-[14px] font-medium", className)}>
      {cents === null || cents === undefined ? "—" : formatUsd(cents, { sign })}
    </span>
  );
}

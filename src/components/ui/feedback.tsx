import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Loading placeholder: skeleton bars, never a spinner (UI §9). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-[4px] bg-surface-2", className)} />;
}

/** One line + optional action (UI §9: "Investigation paused · Retry"). */
export function InlineError({ message, actionLabel, onAction, className }: { message: string; actionLabel?: string; onAction?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex items-center gap-2 text-[14px] text-neg", className)}>
      <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
      <span>{message}</span>
      {actionLabel && onAction && <Button size="sm" variant="ghost" onClick={onAction}>{actionLabel}</Button>}
    </div>
  );
}

/** One short line for empty panels (UI §9: "No cases yet"). */
export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-[14px] text-ink-2">{children}</p>;
}

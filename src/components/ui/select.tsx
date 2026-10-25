import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/** Native select (accessible, keyboard-native) in the v2 style. */
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn("h-8 rounded-[var(--radius-control)] border border-border bg-surface px-2 pr-7 text-[14px] text-ink disabled:opacity-50", className)}
      {...props}
    />
  );
});

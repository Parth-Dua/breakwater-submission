"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        className={cn("z-50 w-80 rounded-[var(--radius-panel)] border border-border bg-surface p-3 text-[14px] text-ink shadow-[var(--shadow-pop)] outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

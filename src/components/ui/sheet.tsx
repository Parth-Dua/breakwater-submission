"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;

/** Bottom sheet (UI §5.6 Journals). Title is required for accessibility; keep it a short noun. */
export function SheetContent({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(16,24,40,0.24)]" />
      <Dialog.Content
        aria-describedby={undefined}
        className={cn("fixed inset-x-0 bottom-0 z-50 max-h-[60vh] overflow-auto rounded-t-[var(--radius-panel)] border-t border-border bg-surface shadow-[var(--shadow-pop)] outline-none", className)}
      >
        <div className="sticky top-0 flex h-12 items-center justify-between border-b border-border bg-surface px-4">
          <Dialog.Title className="section-title">{title}</Dialog.Title>
          <Dialog.Close aria-label="Close" className="rounded-[var(--radius-control)] p-1.5 text-ink-2 hover:bg-surface-2"><X size={16} strokeWidth={1.75} /></Dialog.Close>
        </div>
        <div className="p-4">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

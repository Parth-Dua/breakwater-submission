"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** ⋯ menu (UI §3): "Reset demo" opens a confirm dialog. */
export function OverflowMenu({ onReset }: { onReset: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal size={16} strokeWidth={1.75} /></Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={6} className="z-50 min-w-44 rounded-[var(--radius-panel)] border border-border bg-surface p-1 shadow-[var(--shadow-pop)]">
            <Menu.Item onSelect={() => setConfirmOpen(true)} className="flex h-8 cursor-pointer items-center rounded-[var(--radius-control)] px-2 text-[14px] text-ink outline-none data-[highlighted]:bg-surface-2">Reset demo</Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(16,24,40,0.24)]" />
          <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/3 z-50 w-80 -translate-x-1/2 rounded-[var(--radius-panel)] border border-border bg-surface p-4 shadow-[var(--shadow-pop)] outline-none">
            <Dialog.Title className="section-title">Reset to baseline?</Dialog.Title>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild><Button variant="ghost">Cancel</Button></Dialog.Close>
              <Button variant="danger" onClick={() => { setConfirmOpen(false); onReset(); }}>Reset</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

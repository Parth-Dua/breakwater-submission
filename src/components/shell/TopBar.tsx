import { Waves } from "lucide-react";
import { ActingAs } from "./ActingAs";
import { OverflowMenu } from "./OverflowMenu";

/**
 * v2 top bar (UI §3): wordmark · company · [room title] · clock · [disruption] · acting as · SIM · ⋯
 * Slots are filled by the pages; the bar itself never shows explanatory copy.
 */
export function TopBar({ left, clock, action, onReset }: { left?: React.ReactNode; clock?: React.ReactNode; action?: React.ReactNode; onReset?: () => void }) {
  return (
    <header className="grid h-[var(--topbar-h)] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-border bg-surface px-4 max-[1023px]:h-auto max-[1023px]:grid-cols-[1fr_auto] max-[1023px]:gap-y-2 max-[1023px]:py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[16px] font-semibold tracking-tight text-navy"><Waves size={18} strokeWidth={2} aria-hidden />Breakwater</span>
        <span className="whitespace-nowrap text-[14px] text-ink-2 max-[1350px]:hidden">Meridian Commodities</span>
        {left}
      </div>
      <div className="flex items-center justify-center max-[1023px]:col-span-2 max-[1023px]:row-start-2 max-[1023px]:justify-start">{clock}</div>
      <div className="flex items-center justify-end gap-3 max-[1023px]:col-start-2 max-[1023px]:row-start-1">
        {action}
        <ActingAs />
        <span className="inline-flex h-5 items-center rounded-full border border-border px-2 text-[11px] font-semibold tracking-[0.06em] text-ink-2">SIM</span>
        {onReset && <OverflowMenu onReset={onReset} />}
      </div>
    </header>
  );
}

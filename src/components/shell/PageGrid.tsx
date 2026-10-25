import { cn } from "@/lib/utils";

/** Panel: white surface, 1px border, radius 8, no shadow (UI §1.3). */
export function Panel({ as: Component = "section", className, children, ...props }: React.HTMLAttributes<HTMLElement> & { as?: "section" | "aside" | "div" }) {
  return <Component className={cn("min-h-0 min-w-0 rounded-[var(--radius-panel)] border border-border bg-surface", className)} {...props}>{children}</Component>;
}

/** Desk grid (UI §4): KPI strip 72px; main 1fr + rail 360px; no page scroll at 1440×900. */
export function DeskGrid({ kpis, main, rail }: { kpis: React.ReactNode; main: React.ReactNode; rail: React.ReactNode }) {
  return (
    <div data-testid="desk-grid" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] grid-rows-[72px_minmax(0,1fr)] gap-4 p-4 max-[1023px]:grid-cols-1 max-[1023px]:grid-rows-[72px_minmax(360px,1fr)_auto] max-[1023px]:overflow-auto">
      <div className="col-span-2 min-h-0 max-[1023px]:col-span-1 max-[1023px]:overflow-x-auto">{kpis}</div>
      <div className="min-h-0 min-w-0">{main}</div>
      <div className="min-h-0 min-w-0">{rail}</div>
    </div>
  );
}

/** Voyage Room grid (UI §5): columns [1fr 400px]; rows [1fr 168px 64px]; rail spans stage + timeline. */
export function RoomGrid({ stage, timeline, rail, money }: { stage: React.ReactNode; timeline: React.ReactNode; rail: React.ReactNode; money: React.ReactNode }) {
  return (
    <div data-testid="room-grid" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px] grid-rows-[minmax(0,1fr)_168px_64px] gap-4 p-4 max-[1023px]:grid-cols-1 max-[1023px]:grid-rows-[minmax(320px,1fr)_168px_auto_64px] max-[1023px]:overflow-auto">
      {/* DOM order = keyboard order (UI §11): stage → timeline → rail → money. Placement is explicit. */}
      <div className="col-start-1 row-start-1 min-h-0 min-w-0" data-region="stage">{stage}</div>
      <div className="col-start-1 row-start-2 min-h-0 min-w-0" data-region="timeline">{timeline}</div>
      <div className="col-start-2 row-span-2 row-start-1 min-h-0 min-w-0 max-[1023px]:col-start-1 max-[1023px]:row-span-1 max-[1023px]:row-start-3" data-region="rail">{rail}</div>
      <div className="col-span-2 col-start-1 row-start-3 min-h-0 min-w-0 max-[1023px]:col-span-1 max-[1023px]:row-start-4 max-[1023px]:overflow-x-auto" data-region="money">{money}</div>
    </div>
  );
}

/** Full-height page frame: top bar + grid, no document scroll. */
export function PageFrame({ topBar, children }: { topBar: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex h-dvh flex-col overflow-hidden bg-bg">{topBar}<main id="main-content" className="flex min-h-0 flex-1 flex-col">{children}</main></div>;
}

import { CircleHelp } from "lucide-react";
import type { AskView } from "../../../convex/room";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { Pill } from "@/components/ui/pill";

const ROLES: Record<string, string> = { ops: "Ops", controller: "Controller", trader: "Trader" };
export function AskCard({ ask, role, actionable, onOpen }: { ask: AskView | null | undefined; role: string; actionable: boolean; onOpen: () => void }) {
  if (!ask) return null;
  return <section className="shrink-0 border-t border-border p-4" aria-label="Open ask" data-testid="room-ask"><div className="flex items-center gap-2"><CircleHelp size={15} strokeWidth={1.75} className="text-warn" /><Pill tone="warn">{ROLES[ask.role] ?? "Ops"}</Pill><span className="ml-auto text-[12px] tabular text-warn">{ask.ageDays}d</span>{ask.amountAtRiskCents !== null && <Money cents={ask.amountAtRiskCents} metric={`ask:${ask.code}:risk`} className="text-[14px]" />}</div><div className="my-3 text-[12px] leading-5 text-ink">{ask.shortQuestion}</div>{actionable && <Button size="sm" variant="primary" onClick={onOpen}>{role === ask.role ? "Open" : `Answer as ${ROLES[ask.role] ?? "Ops"}`}</Button>}</section>;
}

import { AlertTriangle, Check, CircleHelp, Hourglass, Loader, Lock, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

// Fixed icon meanings (UI §1.4). Each carries an accessible label; color is never the only signal.
const ICONS = {
  working: { Icon: Loader, label: "Working", className: "text-agent animate-spin [animation-duration:2s]" },
  done: { Icon: Check, label: "Done", className: "text-pos" },
  waiting: { Icon: CircleHelp, label: "Waiting on a person", className: "text-warn" },
  review: { Icon: AlertTriangle, label: "Needs review", className: "text-neg" },
  memory: { Icon: Sparkles, label: "Memory", className: "text-memory" },
  timebar: { Icon: Hourglass, label: "Time bar", className: "text-warn" },
  disruption: { Icon: Zap, label: "Disruption", className: "text-navy" },
  locked: { Icon: Lock, label: "Locked", className: "text-ink-3" },
} as const;

export type StatusKind = keyof typeof ICONS;

export function IconStatus({ kind, size = 16, className, label }: { kind: StatusKind; size?: number; className?: string; label?: string }) {
  const { Icon, label: defaultLabel, className: tone } = ICONS[kind];
  return <Icon size={size} strokeWidth={1.75} role="img" aria-label={label ?? defaultLabel} className={cn("shrink-0", tone, className)} />;
}

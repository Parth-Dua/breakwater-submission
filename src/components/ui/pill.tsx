import { cn } from "@/lib/utils";

export type Tone = "neutral" | "pos" | "neg" | "warn" | "agent" | "memory";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  pos: "bg-[#ECFDF3] text-pos",
  neg: "bg-[#FEF3F2] text-neg",
  warn: "bg-[#FFFAEB] text-warn",
  agent: "bg-[#EFF4FF] text-agent",
  memory: "bg-[#F4F3FF] text-memory",
};

/** Small status pill (UI §1.3: radius 999). Always text, never color alone. */
export function Pill({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium leading-none", TONES[tone], className)}>{children}</span>;
}

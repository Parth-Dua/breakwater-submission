"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { CircleHelp } from "lucide-react";
import { automation } from "@/lib/interactionOrigin";
import { api } from "../../../convex/_generated/api";
import type { AskRow } from "../../../convex/desk";
import type { Role, SelectablePersonaCode } from "@/world/personas";
import { useDesktopActions } from "@/lib/useDesktopActions";
import { Money } from "@/components/ui/money";
import { EmptyLine, InlineError, Skeleton } from "@/components/ui/feedback";

const ROLES = [{ role: "ops", label: "Ops", code: "OPS" }, { role: "controller", label: "Controller", code: "CONTROLLER" }, { role: "trader", label: "Trader", code: "TRADER" }] as const;
export function WaitingOnPeople({ rows }: { rows: Record<Role, AskRow[]> | undefined }) {
  const desktop = useDesktopActions();
  const me = useQuery(api.session.me), changePersona = useMutation(api.session.setActingAs), router = useRouter();
  const [error, setError] = useState(false);
  const open = rows ? ROLES.flatMap(({ role }) => rows[role]) : [];
  async function answer(ask: AskRow) {
    try {
      setError(false);
      const role = ROLES.find(role => role.role === ask.role);
      if (desktop && role && me?.persona.code !== role.code) await changePersona({ code: role.code as SelectablePersonaCode, ...automation() });
      router.push(`/case/${ask.caseCode}`);
    } catch { setError(true); }
  }
  return <section aria-label="Waiting on people"><div className="border-b border-border px-4 py-3"><h2 className="section-title">Waiting on people</h2></div>
    <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">{ROLES.map(({ role, label }) => <span key={role} className={`rounded-full px-2 py-1 text-[11px] tabular ${me?.persona.role === role ? "bg-[#EFF4FF] text-agent" : "bg-surface-2 text-ink-2"}`}>{label} {rows?.[role].length ?? "—"}</span>)}</div>
    {!rows ? <div className="space-y-3 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : !open.length ? <EmptyLine>No open asks</EmptyLine> : <ul className="divide-y divide-border">{open.map(ask => <li key={ask.code} className="p-4 hover:bg-surface-2"><div className="flex items-center gap-2"><CircleHelp size={15} strokeWidth={1.75} className="text-warn" /><button type="button" onClick={() => void answer(ask)} className="font-medium text-ink hover:text-agent">{ask.vessel}</button><span className="ml-auto text-[12px] tabular text-warn">{ask.ageDays}d</span>{ask.amountAtRiskCents !== null && <Money metric={`ask:${ask.code}:risk`} cents={ask.amountAtRiskCents} className="text-[12px]" />}</div><div className="mt-2 truncate text-[12px] text-ink-2" title={ask.question}>{ask.kind === "CONFIRM_FACT" ? `${ask.question.split("?")[0]}?` : ask.kind === "PAYMENT_APPROVAL" ? "Review payable and dispute" : ask.question.replace(/\$[\d,.]+\s*/g, "").trim()}</div><button type="button" onClick={() => void answer(ask)} className="mt-3 text-[12px] font-medium text-agent">{!desktop || me?.persona.role === ask.role ? "Open" : `Answer as ${ROLES.find(role => role.role === ask.role)?.label ?? "Ops"}`}</button></li>)}</ul>}
    {error && <div className="p-4"><InlineError message="Could not open ask" /></div>}
  </section>;
}

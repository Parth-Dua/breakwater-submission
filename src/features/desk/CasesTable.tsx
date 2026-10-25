"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Check, Hourglass } from "lucide-react";
import type { CaseRow } from "../../../convex/desk";
import { Money } from "@/components/ui/money";
import { IconStatus, type StatusKind } from "@/components/ui/icon-status";
import { EmptyLine, Skeleton } from "@/components/ui/feedback";
import { formatTime } from "@/lib/format";

const kindFor = (status: string): StatusKind => status === "WORKING" ? "working" : status === "WAITING_HUMAN" ? "waiting" : status === "NEEDS_REVIEW" ? "review" : "done";
function CaseLink({ code, children, ...props }: { code: string | null; children: React.ReactNode; className?: string; title?: string }) {
  return code ? <Link href={`/case/${code}`} {...props}>{children}</Link> : <span {...props}>{children}</span>;
}
export function CasesTable({ rows }: { rows: CaseRow[] | undefined }) {
  const [closedOpen, setClosedOpen] = useState(false);
  if (!rows) return <div className="space-y-3 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  const open = rows.filter(row => !row.closed), closed = rows.filter(row => row.closed);
  return <div className="h-full overflow-auto"><table className="w-full min-w-[800px] table-fixed border-collapse text-[12px]" aria-label="Cases">
    <colgroup><col className="w-[14%]" /><col className="w-[14%]" /><col className="w-[20%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[5%]" /><col className="w-[11%]" /></colgroup>
    <thead className="sticky top-0 z-10 bg-surface text-left text-ink-2"><tr>{["Vessel", "Owner → Cargo", "Status", "Owe", "Recover", "Net", "", "Updated"].map((title, i) => <th key={i} scope="col" className={`border-b border-border px-2 py-3 font-medium ${i >= 3 && i <= 5 ? "text-right" : ""}`}>{i === 6 ? <Hourglass size={13} aria-label="Time bar" /> : title}</th>)}</tr></thead>
    <tbody>{[...open, ...(closedOpen ? closed : [])].map(row => <tr key={row.key} data-testid="case-row" data-case={row.code ?? undefined} data-vessel={row.vessel} aria-busy={row.status === "WORKING"} className="group animate-case-in border-b border-border/70 hover:bg-surface-2">
      <td className="px-2 py-4"><CaseLink code={row.code} className="block truncate text-[14px] font-semibold text-ink outline-offset-4"><span>{row.vessel}</span><span className="mt-0.5 block truncate text-[12px] font-normal text-ink-2">{row.port}</span></CaseLink></td>
      <td className="px-2 py-4"><CaseLink code={row.code} className="block truncate text-ink-2" title={`${row.owner} → ${row.cargo}`}>{row.owner} <span className="text-ink-3">→</span> {row.cargo}</CaseLink></td>
      <td className="px-2 py-4"><CaseLink code={row.code} className="flex min-w-0 items-center gap-2" title={row.statusLine}><IconStatus kind={kindFor(row.status)} size={14} /><span className="truncate" data-testid="case-status">{row.statusLine}</span></CaseLink></td>
      <td className="px-2 py-4 text-right"><Money metric={`case:${row.code ?? row.key}:owe`} cents={row.oweCents} className="text-[14px]" /></td>
      <td className="px-2 py-4 text-right"><Money metric={`case:${row.code ?? row.key}:recover`} cents={row.recoverCents} className="text-[14px]" /></td>
      <td className="px-2 py-4 text-right"><Money metric={`case:${row.code ?? row.key}:net`} cents={row.netCents} sign className={`text-[14px] ${row.netCents !== null && row.netCents < 0 ? "text-neg" : "text-pos"}`} /></td>
      <td className="px-2 py-4 text-center tabular">{row.recoveryFiled ? <Check size={14} className="text-pos" aria-label="Filed" /> : row.daysToTimeBar !== null ? <span className={row.daysToTimeBar < 7 ? "text-warn" : "text-ink-2"}>{row.daysToTimeBar}d</span> : "—"}</td>
      <td className="px-2 py-4 font-mono text-[12px] text-ink-2">{formatTime(row.updatedAt)}</td>
    </tr>)}</tbody>
  </table>{!open.length && !closedOpen && <EmptyLine>No open cases</EmptyLine>}{closed.length > 0 && <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-[12px] text-ink-2 hover:bg-surface-2" onClick={() => setClosedOpen(value => !value)} aria-expanded={closedOpen}>{closedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{closed.length} closed</button>}</div>;
}

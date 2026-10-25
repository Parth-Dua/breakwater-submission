"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Money } from "@/components/ui/money";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/feedback";
import { formatDate } from "@/lib/format";
import { automation, useStartWork, type WorkSurface } from "./useWork";

export function RecoveryDecision({ work }: { work: WorkSurface }) {
  useStartWork(work.code);
  const answer = useMutation(api.asks.answer), [option, setOption] = useState("PURSUE"), [amount, setAmount] = useState(""), [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const validAmount = /^\d{1,12}(\.\d{1,2})?$/.test(amount), [dollars, fraction = ""] = amount.split("."), cents = validAmount ? Number(BigInt(dollars) * 100n + BigInt(fraction.padEnd(2, "0"))) : -1;
  const valid = option === "PURSUE" || reason.trim() && (option === "WAIVE" || Number.isSafeInteger(cents) && cents > 0 && cents <= (work.amountAtRiskCents ?? 0));
  async function submit() { setBusy(true); setError(false); try { await answer({ askCode: work.code, answer: { optionId: option, ...(option === "PARTIAL" ? { amountCents: cents } : {}), ...(option !== "PURSUE" ? { reason } : {}) }, ...automation() }); } catch { setError(true); } finally { setBusy(false); } }
  return <div className="h-full overflow-auto p-6" data-testid="recovery-decision"><div className="mx-auto max-w-xl space-y-5"><div className="flex items-center gap-2"><h2 className="section-title">{work.counterparty}</h2>{work.strategic && <Pill tone="warn">Strategic</Pill>}</div><div className="flex items-end justify-between"><div><div className="label">Claim</div><Money cents={work.amountAtRiskCents} metric={`work:${work.code}:claim`} size="kpi" /></div>{work.deadlineAt !== null && <div className="font-mono text-[12px] text-warn">{formatDate(work.deadlineAt)} · {Math.max(0, Math.ceil((work.deadlineAt - work.simNow) / 86400000))} d</div>}</div>
    {work.recent.length > 0 && <div className="divide-y divide-border rounded border border-border">{work.recent.map(row => <div key={row.code} className="flex gap-3 p-3 text-[12px]"><span className="font-mono text-ink-2">{row.at !== undefined ? formatDate(row.at) : "—"}</span><Money cents={row.cents} metric={`work:${work.code}:history:${row.code}`} /><span className="ml-auto text-ink-2">{row.outcome}</span></div>)}</div>}
    <div className="flex gap-2" role="group" aria-label="Recovery decision">{work.options.map(choice => <Button key={choice.id} size="sm" variant={choice.id === option ? "primary" : "outline"} aria-pressed={choice.id === option} onClick={() => setOption(choice.id)}>{choice.label}</Button>)}</div>
    {option === "PARTIAL" && <label className="block text-[12px]">File amount<input className="mt-1 block h-9 w-full rounded border border-border px-3 font-mono" aria-label="File amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>}
    {option !== "PURSUE" && <label className="block text-[12px]">Reason<textarea className="mt-1 block w-full rounded border border-border p-3 text-[12px]" maxLength={240} value={reason} onChange={event => setReason(event.target.value)} /></label>}
    <Button variant="primary" disabled={busy || !valid} onClick={() => void submit()}>Submit</Button>{error && <InlineError message="Could not submit this decision" />}
  </div></div>;
}

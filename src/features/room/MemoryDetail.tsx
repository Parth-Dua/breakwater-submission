"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton, InlineError } from "@/components/ui/feedback";
import { formatDate } from "@/lib/format";
import { useDesktopActions } from "@/lib/useDesktopActions";
import { automation } from "../work/useWork";

export function MemoryDetail({ code }: { code: string }) {
  const data = useQuery(api.memory.detail, { memoryCode: code }), decide = useMutation(api.memory.decide), revoke = useMutation(api.memory.revoke), desktop = useDesktopActions();
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(false), [revoking, setRevoking] = useState(false);
  async function act(decision: "APPROVE" | "REJECT" | "REVOKE") { setBusy(true); setError(false); try { if (decision === "REVOKE") await revoke({ memoryCode: code, reason, ...automation() }); else await decide({ memoryCode: code, decision, ...(reason.trim() ? { reason } : {}), ...automation() }); } catch { setError(true); } finally { setBusy(false); } }
  if (!data) return <div className="space-y-2"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" /></div>;
  return <div className="space-y-3 text-[12px] leading-5" data-testid={`memory-detail-${code}`}>
    {(data.agentDid || data.humanDid) && <div><div className="label mb-1">What changed</div><div className="text-ink-2">I did: {data.agentDid}</div><div className="text-ink-2">{data.automated ? "Test did" : "Human did"}: {data.humanDid}</div>{data.basis?.clause && <div className="font-mono text-[11px] text-ink-2">Cl. {data.basis.clause} · {data.basis.note}</div>}</div>}
    {data.reason && <div><span className="label">Decision</span><div className="truncate text-ink-2" title={data.reason}>{data.reason.replace(/Classifier unavailable/gi,"Lesson needs review")}</div></div>}
    {data.backtest && <div><span className="label">Backtest</span><div className={data.backtest.consistent === data.backtest.total ? "text-pos" : "text-warn"}>{data.backtest.consistent}/{data.backtest.total} consistent</div></div>}
    {data.approvedBy && <div className="text-ink-2">Approved by {data.approvedBy}{data.approvedAt !== null ? ` · ${formatDate(data.approvedAt)}` : ""}</div>}
    {desktop && data.canReject && <div className="space-y-2"><input aria-label="Memory decision reason" placeholder="Reason" maxLength={240} value={reason} onChange={event => setReason(event.target.value)} className="h-8 w-full rounded border border-border px-2 text-[12px]" /><div className="flex gap-2">{data.canApprove && <Button size="sm" variant="primary" disabled={busy || data.needsReason && !reason.trim()} onClick={() => void act("APPROVE")}>{data.needsScope ? "Request scope" : "Approve"}</Button>}<Button size="sm" disabled={busy || !reason.trim()} onClick={() => void act("REJECT")}>Reject</Button></div></div>}
    {desktop && data.canRevoke && <div className="space-y-2">{revoking && <input aria-label="Revocation reason" placeholder="Reason" maxLength={240} className="h-8 w-full rounded border border-border px-2 text-[12px]" value={reason} onChange={event => setReason(event.target.value)} />}<Button size="sm" variant="ghost" disabled={busy || revoking && !reason.trim()} onClick={() => revoking ? void act("REVOKE") : setRevoking(true)}>{revoking ? "Confirm revocation" : "Revoke"}</Button></div>}
    {error && <InlineError message="Could not save this decision" />}
  </div>;
}

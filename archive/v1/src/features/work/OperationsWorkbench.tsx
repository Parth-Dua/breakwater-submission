"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useWorkspaceUser } from "@/lib/use-workspace-user";
import { RouteShell } from "@/components/layout/route-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, PermissionDenied, StatusText } from "@/components/ui/states";
import { Money } from "@/components/ui/money";
import { formatUtc } from "@/lib/format";
import { TimeMachine } from "../voyage/TimeMachine";
import { ArchiveSearch } from "./ArchiveSearch";
import { FindingForm } from "./FindingForm";
type Review = FunctionReturnType<typeof api.workItems.get>;
export function OperationsWorkbench({ id }: { id: string }) {
  const { ready, isLoading } = useWorkspaceUser(), valid = /^[a-z0-9]{20,40}$/.test(id), review = useQuery(api.workItems.get, ready && valid ? { workItemId: id as Id<"workItems"> } : "skip");
  const title = review ? `Review delay cause — ${review.voyageCode}` : `Review ${id}`;
  return <><Link href="/work" className="back-link">← Work queue</Link><RouteShell title={title} eyebrow="OPERATIONS REVIEW" description="Resolve the missing fact through source-backed investigation.">{isLoading || (ready && valid && review === undefined) ? <LoadingState/> : !ready ? <PermissionDenied/> : !valid || !review ? <EmptyState title="Review unavailable" description="This review is not available in the current workspace."/> : <ReviewContent review={review}/>}</RouteShell></>;
}
function ReviewContent({ review }: { review: Review }) {
  const { user } = useWorkspaceUser(), claimTask = useMutation(api.workItems.claimTask), record = useMutation(api.workItems.recordObservation), detail = useQuery(api.claims.getDetail, { code: review.claim.claimCode });
  const root = useRef<HTMLDivElement>(null), [pending, setPending] = useState(false), [error, setError] = useState("");
  const session = review.session, editable = session?.status === "OPEN" && review.work.status === "CLAIMED" && review.work.claimedBy === user?.id && user?.role === "operations_reviewer";
  useEffect(() => {
    const element = root.current; if (!element || !editable || !session) return;
    const observe = (event: Event) => {
      const detail = (event as CustomEvent).detail as { evidenceId?: Id<"evidence">; startAt?: number; endAt?: number };
      const semantic = event.type === "breakwater:evidence-opened" && detail.evidenceId ? { type: "EVIDENCE_OPENED" as const, evidenceId: detail.evidenceId } : event.type === "breakwater:range-selected" && detail.startAt !== undefined && detail.endAt !== undefined ? { type: "TIMELINE_RANGE_SELECTED" as const, startAt: detail.startAt, endAt: detail.endAt } : null;
      if (semantic) void record({ sessionId: session._id, event: semantic }).catch(() => setError("Observation could not be recorded. Your session may have closed; refresh before continuing."));
    };
    element.addEventListener("breakwater:evidence-opened", observe); element.addEventListener("breakwater:range-selected", observe);
    return () => { element.removeEventListener("breakwater:evidence-opened", observe); element.removeEventListener("breakwater:range-selected", observe); };
  }, [editable, session, record]);
  async function start() { setPending(true); setError(""); try { await claimTask({ workItemId: review.work._id }); } catch { setError("This review is already assigned, closed, or unavailable for your role."); } finally { setPending(false); } }
  return <div ref={root} className="operations-workbench"><div className="review-question"><div className="review-question-label"><span>AGENT QUESTION</span><StatusText tone={review.work.status === "SUBMITTED" ? "verified" : "unverified"}>{review.work.status.replaceAll("_", " ")}</StatusText></div><h2>{review.work.question}</h2><p>{review.vesselName} · {review.voyageCode} · <Money cents={review.work.amountAtRiskCents ?? 0}/> at risk · Synthetic records</p>
    {(review.work.affectedIntervals ?? []).map(window => <small key={window.startAt}>{formatUtc(window.startAt)} — {formatUtc(window.endAt)}</small>)}
    {!editable && ["OPEN", "WAITING_INFORMATION"].includes(review.work.status) && user?.role === "operations_reviewer" && <Button variant="primary" disabled={pending} onClick={() => void start()}>{review.work.status === "WAITING_INFORMATION" ? "Resume review" : "Start review"}</Button>}
    {editable && <p className="verified-text">Review assigned to you. Search the archive, compare the interval, then submit a source-backed finding.</p>}
    {review.work.clarification && <p className="clarification-note">Clarification requested: {review.work.clarification}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}</div>
    <details className="completed-agent-checks"><summary>Completed agent checks · {review.checks.length}</summary><ul>{review.checks.map((check, index) => <li key={`${check.tool}-${index}`}>{check.tool.replaceAll("_", " ")} <span>{check.status}</span></li>)}</ul>{!review.checks.length && <p className="muted">No live provider checks recorded for this test fixture.</p>}</details>
    {session && <p className="capture-label">{session.captureOrigin === "AUTOMATED_TEST" ? "Automated test session — excluded from human-learning proof" : "Application work session"} · {session.status.toLowerCase()}</p>}
    {editable && session && <div className="work-review-panels"><ArchiveSearch sessionId={session._id} linkedIds={review.work.evidenceIds}/><FindingForm key={session._id} sessionId={session._id} work={review.work} evidence={review.evidence}/></div>}
    {review.work.status === "SUBMITTED" && review.work.finding && <div className="submitted-finding" role="status"><h2>Finding submitted · {review.work.finding.cause}</h2><p>{review.work.finding.note}</p><small>Source references: {review.work.finding.evidenceIds.map(id => review.evidence.find(source => source._id === id)?.evidenceCode ?? id).join(", ")}</small><p>The agent continuation is scheduled automatically. Financial authority remains separate.</p></div>}
    {detail === undefined ? <LoadingState/> : detail && <><p className="review-timeline-note">Linked review sources appear on the timeline. Claim treatment updates after a valid finding is submitted.</p><TimeMachine detail={{ ...detail, evidence: review.evidence }}/></>}
    {session && <details className="observed-history"><summary>Observed activity · {review.events.length} actions</summary><ol>{review.events.map(event => <li key={event._id}><div><strong>{event.eventType.replaceAll("_", " ").toLowerCase()}</strong><time>{formatUtc(event.at)}</time></div><small>Sequence {event.sequence + 1} · Actor {event.actorId} · {event.actorRole.replaceAll("_", " ")}</small><p>{JSON.stringify(event.payload)}</p></li>)}</ol></details>}
  </div>;
}

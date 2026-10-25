"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useWorkspaceUser } from "@/lib/use-workspace-user";
import { Button } from "@/components/ui/button";
import { formatUtc } from "@/lib/format";
export function InvestigationTrace({ claimId, revision }: { claimId: Id<"claims">; revision: number }) {
  const { ready, user } = useWorkspaceUser(), runs = useQuery(api.investigations.listForClaim, ready ? { claimId } : "skip"), start = useMutation(api.investigations.start);
  const [pending, setPending] = useState(false), [error, setError] = useState(false), current = runs?.find(run => run.revision === revision);
  async function investigate() { setPending(true); setError(false); try { await start({ claimId }); } catch { setError(true); } finally { setPending(false); } }
  return <section className="investigation-trace"><div className="trace-heading"><div><h3>Agent investigation</h3><p>Claude reasoning · validated tools · deterministic financial checks</p></div>{user?.role !== "auditor" && <Button disabled={!ready || runs === undefined || pending || !!current} onClick={() => void investigate()}>{pending ? "Scheduling…" : current ? "Investigation recorded" : "Investigate claim"}</Button>}</div>
    {error && <p role="alert" className="form-error">Could not schedule investigation. Try again.</p>}
    {!runs?.length && <p className="muted">No investigation recorded for this claim. No provider result is implied.</p>}
    {runs?.map(run => <div className="agent-run" key={run.id}><div className="run-state"><strong>{run.state.replaceAll("_", " ")}</strong><span>Revision {run.revision} · Attempt {run.attempt} · {run.step} tools</span></div><small>Correlation: {run.correlationId}</small>
      {run.lastError && <p role="status" className="form-error">{run.lastError.replaceAll("_", " ")}{run.state === "FAILED_RETRYABLE" ? " · Retry scheduled from persisted state." : " · Investigation stopped; no model result fabricated."}</p>}
      {run.providerModel && <p className="muted">Live provider: {run.providerModel} · {run.providerTurns} responses · {run.inputTokens} input / {run.outputTokens} output tokens</p>}
      {run.finalSummary && <details><summary>Model summary · reasoning, not authority</summary><p className="model-summary">{run.finalSummary}</p></details>}
      {run.toolOutcomes.map((outcome, index) => <details className="tool-outcome" key={`${index}-${outcome.at}`}><summary><span>{String(index + 1).padStart(2, "0")} · {outcome.tool}</span><i className={outcome.status === "OK" ? "verified-text" : "unverified-text"}>{outcome.status}</i></summary><p className="muted">{formatUtc(outcome.at)} · {outcome.sourceIds.length} source reference(s)</p><pre>{outcome.result}</pre></details>)}
      {run.workItemId && <Link className="text-link" href={`/work/${run.workItemId}`}>Open Operations question →</Link>}
    </div>)}
  </section>;
}

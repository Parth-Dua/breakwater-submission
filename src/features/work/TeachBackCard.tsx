"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/feedback";
import { automation } from "./useWork";

export function TeachBackCard({ caseCode, onLearned }: { caseCode: string; onLearned?: () => void }) {
  const ask = useQuery(api.work.teachBack, { caseCode }), answer = useMutation(api.asks.answer), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  if (!ask) return null;
  async function submit(optionId: string) { if (!ask) return; setBusy(true); setError(false); try { await answer({ askCode: ask.code, answer: { optionId }, ...automation() }); onLearned?.(); } catch { setError(true); } finally { setBusy(false); } }
  return <section className="space-y-3 border-t border-border bg-[#F4F3FF] p-4" aria-label="Teach back"><h3 className="text-[14px] font-medium">Next time?</h3><div className="flex flex-wrap gap-2">{ask.options.map(option => <Button key={option.id} size="sm" variant="outline" disabled={busy} onClick={() => void submit(option.id)}>{option.label}</Button>)}</div>{error && <InlineError message="Could not save this choice" />}</section>;
}

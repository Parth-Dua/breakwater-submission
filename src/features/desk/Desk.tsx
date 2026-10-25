"use client";
import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Pause, Play, Zap } from "lucide-react";
import { automation } from "@/lib/interactionOrigin";
import { api } from "../../../convex/_generated/api";
import { DeskGrid, PageFrame, Panel } from "@/components/shell/PageGrid";
import { TopBar } from "@/components/shell/TopBar";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { InlineError, Skeleton } from "@/components/ui/feedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDesktopActions } from "@/lib/useDesktopActions";
import { formatClock } from "@/lib/format";
import { KpiStrip } from "./KpiStrip";
import { CasesTable } from "./CasesTable";
import { BooksTab } from "./BooksTab";
import { ProofTab } from "./ProofTab";
import { WaitingOnPeople } from "./WaitingOnPeople";
import { LearnedList } from "./LearnedList";

const ROLE_LABEL: Record<string, string> = { controller: "Controller", trader: "Trader", ops: "Ops" };
export function Desk() {
  const desktop = useDesktopActions();
  const { isAuthenticated } = useConvexAuth();
  const summary = useQuery(api.desk.summary), rows = useQuery(api.desk.cases), waiting = useQuery(api.desk.waitingOnPeople), learned = useQuery(api.desk.learnedRecently, { limit: 5 });
  const clock = useQuery(api.sim.clock), me = useQuery(api.session.me);
  const startDisruption = useMutation(api.sim.startDisruption), letTimePass = useMutation(api.sim.letTimePass), reset = useMutation(api.demo.reset);
  const [error, setError] = useState<string | null>(null), [starting, setStarting] = useState(false);
  async function start() { setStarting(true); setError(null); try { await startDisruption(automation()); } catch { setError("Could not start disruption"); } finally { setStarting(false); } }
  async function passTime() { setError(null); try { await letTimePass(automation()); } catch { setError("Could not advance clock"); } }
  async function restore() { setError(null); try { await reset({ confirm: "demo", ...automation() }); } catch { setError("Could not reset"); } }
  const clockSlot = clock ? <div className="flex items-center gap-2 whitespace-nowrap max-[1023px]:flex-wrap"><time className="font-mono text-[12px] tabular" dateTime={new Date(clock.simNow).toISOString()}>{formatClock(clock.simNow)}</time><Pill tone={clock.status === "RUNNING" ? "agent" : clock.status === "HELD" ? "warn" : "neutral"}>{clock.status === "HELD" ? `Held · ${ROLE_LABEL[clock.holdReason ?? ""] ?? "Ops"}` : clock.status === "RUNNING" ? "Running" : "Idle"}</Pill>{desktop && clock.status === "HELD" && <Button size="sm" variant="ghost" onClick={() => void passTime()}><Play size={12} />Let time pass</Button>}</div> : <Skeleton className="h-4 w-52" />;
  const action = desktop ? <Button variant="primary" disabled={!isAuthenticated || !clock?.disruptionAvailable || starting} onClick={() => void start()} title={clock?.disruptionActive ? "Disruption in progress" : "Start disruption"} className="max-[1023px]:hidden"><Zap size={15} strokeWidth={1.75} />New disruption</Button> : undefined;
  return <PageFrame topBar={<TopBar clock={clockSlot} action={action} onReset={desktop && me && me.persona.role !== "observer" ? () => void restore() : undefined} />}>
    {error && <div className="border-b border-border bg-surface px-4 py-2"><InlineError message={error} /></div>}
    <DeskGrid kpis={<KpiStrip summary={summary} />} main={<Panel className="flex h-full flex-col"><Tabs defaultValue="cases" className="flex min-h-0 flex-1 flex-col"><TabsList><TabsTrigger value="cases">Cases</TabsTrigger><TabsTrigger value="books">Books</TabsTrigger><TabsTrigger value="proof">Proof</TabsTrigger><span className="mb-2 ml-auto inline-flex items-center gap-1.5 text-[11px] text-ink-2">{clock?.status === "RUNNING" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-agent" /> : <Pause size={10} />}<span>{clock?.status === "RUNNING" ? "Live" : "Current"}</span></span></TabsList><TabsContent value="cases" className="min-h-0 flex-1"><CasesTable rows={rows} /></TabsContent><TabsContent value="books" className="min-h-0 flex-1"><BooksTab periods={summary?.periods ?? []} /></TabsContent><TabsContent value="proof" className="min-h-0 flex-1"><ProofTab /></TabsContent></Tabs></Panel>} rail={<Panel as="aside" className="h-full overflow-auto"><WaitingOnPeople rows={waiting} /><LearnedList rows={learned} /></Panel>} />
  </PageFrame>;
}

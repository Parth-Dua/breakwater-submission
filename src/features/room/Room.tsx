"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Play } from "lucide-react";
import { automation } from "@/lib/interactionOrigin";
import { api } from "../../../convex/_generated/api";
import type { DocumentView, EvidenceView } from "../../../convex/room";
import { PageFrame, Panel, RoomGrid } from "@/components/shell/PageGrid";
import { TopBar } from "@/components/shell/TopBar";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { InlineError, Skeleton } from "@/components/ui/feedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatClock } from "@/lib/format";
import { useDesktopActions } from "@/lib/useDesktopActions";
import { VesselMap } from "./Map";
import { Timeline } from "./Timeline";
import { DocumentViewer } from "./DocumentViewer";
import { ThinkingFeed } from "./ThinkingFeed";
import { MemoryList } from "./MemoryList";
import { AskCard } from "./AskCard";
import { MoneyStrip } from "./MoneyStrip";

import { OpsDesk } from "../work/OpsDesk";
import { StatementEditor } from "../work/StatementEditor";
import { RecoveryDecision } from "../work/RecoveryDecision";
import { TeachBackCard } from "../work/TeachBackCard";

const ROLES = { ops: "OPS", controller: "CONTROLLER", trader: "TRADER" } as const;
const ROLE_LABEL: Record<string, string> = { ops: "Ops", controller: "Controller", trader: "Trader" };

type Selection = { code: string; quote?: string; page?: number };
export function Room({ caseCode }: { caseCode: string }) {
  const desktop = useDesktopActions();
  const [cursor, setCursor] = useState<number | null>(null), [selection, setSelection] = useState<Selection | null>(null), [rail, setRail] = useState("thinking"), [memory, setMemory] = useState<string | null>(null);
  const [mapOverrideRole, setMapOverrideRole] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const header = useQuery(api.room.header, { caseCode }), me = useQuery(api.session.me), clock = useQuery(api.sim.clock);
  const map = useQuery(api.room.map, { caseCode, ...(cursor !== null ? { at: cursor } : {}) }), timeline = useQuery(api.room.timeline, { caseCode });
  const thinking = useQuery(api.room.thinking, { caseCode }), memories = useQuery(api.room.memory, { caseCode }), ask = useQuery(api.room.openAsk, { caseCode }), money = useQuery(api.room.money, { caseCode });
  const details = useQuery(api.work.surface, { caseCode });
  const documents = useQuery(api.room.documents, { caseCode }), work = useQuery(api.room.workSurface, { caseCode });
  const changePersona = useMutation(api.session.setActingAs), letTimePass = useMutation(api.sim.letTimePass), reset = useMutation(api.demo.reset);
  const role = me?.persona.role ?? "observer";
  const document = documents?.find(document => document.code === selection?.code);
  const openDocument = useCallback((document: DocumentView, quote?: string) => { setSelection({ code: document.code, ...(quote ? { quote } : {}) }); setMapOverrideRole(null); }, []);
  const openEvidence = useCallback((ref: EvidenceView) => {
    if (ref.documentCode) { setSelection({ code: ref.documentCode, ...(ref.quote ? { quote: ref.quote } : {}), ...(ref.page ? { page: ref.page } : {}) }); setMapOverrideRole(null); }
    else if (ref.from !== undefined) { setCursor(ref.from); setSelection(null); setMapOverrideRole(role); }
    else if (ref.memoryCode) { setRail("memory"); setMemory(ref.memoryCode); }
  }, [role]);
  const openMemory = useCallback((code: string) => { setRail("memory"); setMemory(code); }, []);
  async function openAsk() {
    if (!ask || !desktop) return;
    setError(null);
    try { const code = ROLES[ask.role as keyof typeof ROLES]; if (code && role !== ask.role) await changePersona({ code, ...automation() }); setSelection(null); setMapOverrideRole(null); if (ask.memoryCode) { setRail("memory"); setMemory(ask.memoryCode); } }
    catch { setError("Could not open ask"); }
  }
  async function passTime() { try { await letTimePass(automation()); } catch { setError("Could not advance clock"); } }
  async function restore() { try { await reset({ confirm: "demo", ...automation() }); } catch { setError("Could not reset"); } }
  const stageMode = document ? "DOCUMENT" : !desktop || mapOverrideRole === role ? "MAP" : work?.mode ?? "MAP";
  const clockSlot = clock ? <div className="flex items-center gap-2 whitespace-nowrap max-[1023px]:flex-wrap"><time className="font-mono text-[12px]" dateTime={new Date(clock.simNow).toISOString()}>{formatClock(clock.simNow)}</time><Pill tone={clock.status === "RUNNING" ? "agent" : clock.status === "HELD" ? "warn" : "neutral"}>{clock.status === "HELD" ? `Held · ${ROLE_LABEL[clock.holdReason ?? ""] ?? "Ops"}` : clock.status === "RUNNING" ? "Running" : "Idle"}</Pill>{desktop && clock.status === "HELD" && <Button variant="ghost" size="sm" onClick={() => void passTime()}><Play size={12} />Let time pass</Button>}</div> : <Skeleton className="h-4 w-52" />;
  return <PageFrame topBar={<TopBar clock={clockSlot} onReset={desktop && role !== "observer" ? () => void restore() : undefined} left={<div className="flex min-w-0 items-center gap-3"><Link href="/" className="inline-flex shrink-0 items-center gap-1 text-[12px] text-ink-2 hover:text-ink"><ArrowLeft size={14} />Desk</Link>{header && <div className="min-w-0 max-[1023px]:hidden" title={header.code}><div className="truncate text-[14px] font-semibold">{header.vessel} · {header.port}</div><div className="truncate text-[11px] text-ink-2">{header.owner} → {header.cargo}</div></div>}</div>} />}>
    {error && <div className="px-4 py-2"><InlineError message={error} /></div>}
    <RoomGrid stage={<Panel className="h-full overflow-hidden" data-testid="room-stage" data-mode={stageMode}>{stageMode === "DOCUMENT" && document ? <DocumentViewer key={document.code} document={document} quote={selection?.quote} initialPage={selection?.page} onBack={() => { setSelection(null); setMapOverrideRole(role); }} /> : stageMode === "MAP" ? <VesselMap key={caseCode} data={map} onEvidence={openEvidence} /> : details ? details.kind === "CONFIRM_FACT" ? <OpsDesk key={details.code} caseCode={caseCode} work={details} /> : details.kind === "PAYMENT_APPROVAL" ? <StatementEditor key={details.code} work={details} onEvidence={openEvidence} /> : <RecoveryDecision key={details.code} work={details} /> : <Skeleton className="m-4 h-64" />}</Panel>}
      timeline={<Timeline data={timeline} cursor={cursor} onCursor={setCursor} onDocument={openDocument} />}
      rail={<Panel as="aside" className="flex h-full min-h-0 flex-col"><Tabs value={rail} onValueChange={setRail} className="flex min-h-0 flex-1 flex-col"><TabsList><TabsTrigger value="thinking">Thinking</TabsTrigger><TabsTrigger value="memory">Memory</TabsTrigger></TabsList><TabsContent value="thinking" className="min-h-0 flex-1 overflow-auto"><ThinkingFeed data={thinking} onEvidence={openEvidence} onMemory={openMemory} /></TabsContent><TabsContent value="memory" className="min-h-0 flex-1 overflow-auto"><MemoryList rows={memories} selected={memory} /></TabsContent></Tabs>{desktop && <TeachBackCard caseCode={caseCode} onLearned={() => setRail("memory")} />}<AskCard ask={ask} role={role} actionable={desktop} onOpen={() => void openAsk()} /></Panel>}
      money={<MoneyStrip caseCode={caseCode} data={money} onEvidence={openEvidence} />} />
  </PageFrame>;
}

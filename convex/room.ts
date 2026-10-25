import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { caseTimeBar } from "./views/timeBar";
import { currentPersona } from "./lib/persona";
import { getSimNow } from "./lib/clock";
import { activeOverrides, currentFacts, factValue, intervalFacts, latestStatement, loadCase } from "./agent/state";
import { buildProvenance, templateExplanation } from "../src/domain/provenance";
import { computeStatement, type EvidenceRef } from "../src/domain/laytime";
import { detectAisGaps, pointInPolygon, positionAt, type AisPoint, type Polygon } from "../src/domain/geo";
import { formatTime } from "../src/lib/format";
import { DEMO_NS } from "../src/world/personas";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const args = { caseCode: v.string() };
export type EvidenceView = { kind: string; label: string; documentCode?: string; quote?: string; page?: number; from?: number; to?: number; memoryCode?: string };
export type DocumentView = { code: string; kind: string; title: string; receivedAt: number | null; url: string | null };
export type RoomMap = { simNow: number; viewAt: number; port: { code: string; name: string; anchorage: Polygon; berth: Polygon }; track: AisPoint[]; vesselNow: (AisPoint & { gap: boolean }) | null; gaps: { startAt: number; endAt: number }[]; shifting: { startAt: number; endAt: number }[]; nor: { at: number; lon: number; lat: number; valid: boolean; distanceNm: number; evidence: EvidenceView[] } | null; clockJump: { from: number; atWall: number } | null };
export type TimelineBand = { from: number; to: number; label: string; treatment?: string; clause?: string; kind: string };
export type TimelineView = { startAt: number; endAt: number; simNow: number; lanes: { name: string; bands: TimelineBand[] }[]; docs: { at: number; label: string; document: DocumentView; quote?: string }[] };
export type StepView = { key: string; title: string; status: string; observation?: string; check?: string; conclusion?: string; evidence: EvidenceView[]; memories: string[]; deltaCents: number | null; at: number; tools: string[] };
export type MemoryView = { code: string; title: string; kind: string; status: string; group: "Learned here" | "Used here" | "Recent"; from: string | null; at: number; wallCreatedAt: number; newEligible: boolean; usedIn: { code: string; vessel: string }[]; reason: string | null };
export type AskView = { code: string; kind: string; role: string; question: string; shortQuestion: string; amountAtRiskCents: number | null; ageDays: number; memoryCode?: string };
export type RoomMoney = { version: string; billedCents: number | null; oweCents: number | null; recoverCents: number | null; netCents: number | null; payableState: string; recoveryState: string; waivedCents: number; timeBar: { at: number | null; days: number | null; filed: boolean } };

export async function bundleFor(ctx: QueryCtx, code: string) {
  const item = await ctx.db.query("cases").withIndex("by_code", q => q.eq("ns", DEMO_NS).eq("code", code)).unique();
  return item ? loadCase(ctx, item._id) : null;
}

async function visibleDocuments(ctx: QueryCtx, bundle: NonNullable<Awaited<ReturnType<typeof bundleFor>>>) {
  const now = await getSimNow(ctx, DEMO_NS);
  return (await ctx.db.query("documents").withIndex("by_ns", q => q.eq("ns", DEMO_NS)).collect()).filter(document => (document.receivedAt === undefined || document.receivedAt <= now) && (
    document.caseId === bundle.case._id || document._id === bundle.charter.documentId || document._id === bundle.cargo.documentId ||
    document.vesselId === bundle.vessel._id && (document.receivedAt ?? 0) >= bundle.case.openedAt ||
    document.portId === bundle.port._id && ["PORT_ADVISORY", "PORT_CLOSURE"].includes(document.kind) && (document.receivedAt ?? 0) >= bundle.case.openedAt
  )).sort((a, b) => (a.receivedAt ?? 0) - (b.receivedAt ?? 0));
}
async function documentView(ctx: QueryCtx, document: Doc<"documents">): Promise<DocumentView> {
  return { code: document.code, kind: document.kind, title: document.title, receivedAt: document.receivedAt ?? null, url: await ctx.storage.getUrl(document.storageId) };
}

export async function evidenceViews(ctx: QueryCtx, refs: EvidenceRef[]): Promise<EvidenceView[]> {
  const views: EvidenceView[] = [];
  for (const ref of refs) {
    if (ref.kind === "DOC") {
      const id = ctx.db.normalizeId("documents", ref.documentId);
      const candidate = id ? await ctx.db.get(id) : await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", DEMO_NS).eq("code", ref.documentId)).unique();
      const document = candidate?.ns === DEMO_NS && (candidate.receivedAt ?? 0) <= await getSimNow(ctx, DEMO_NS) ? candidate : null;
      if (document) views.push({ kind: ref.kind, label: document.kind === "OWNER_INVOICE" ? "Invoice" : document.kind === "PORT_CLOSURE" ? "Closure notice" : document.kind === "CUSTOMS_RELEASE" ? "Customs release" : document.kind === "CHARTER_PARTY" ? "Charter party" : document.kind === "NOR" ? "NOR" : document.kind === "SOF" ? "SOF" : document.title, documentCode: document.code, ...(ref.quote ? { quote: ref.quote } : {}), ...(ref.page ? { page: ref.page } : {}) });
    } else if (ref.kind === "CLAUSE") {
      const contract = await ctx.db.query("contracts").withIndex("by_code", q => q.eq("ns", DEMO_NS).eq("code", ref.contractId)).unique();
      const doc = contract?.documentId ? await ctx.db.get(contract.documentId) : null;
      views.push({ kind: ref.kind, label: `Cl. ${ref.clause}`, ...(doc ? { documentCode: doc.code } : {}), ...(doc?.kind === "CHARTER_PARTY" && ref.clause === "8" ? { page: 3 } : {}) });
    } else if (ref.kind === "AIS") views.push({ kind: ref.kind, label: `AIS ${formatTime(ref.from).split(" ").at(-1)}`, from: ref.from, to: ref.to });
    else if (ref.kind === "MEMORY") views.push({ kind: ref.kind, label: "Memory", memoryCode: ref.memoryItemId });
    else views.push({ kind: ref.kind, label: ref.kind === "ASK" ? "Approval" : "Journal" });
  }
  return views.filter((view, i, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(view)) === i);
}

export const header = query({ args, returns: v.any(), handler: async (ctx, { caseCode }) => {
  const b = await bundleFor(ctx, caseCode);
  return b ? { code: b.case.code, vessel: b.vessel.name, port: b.port.name, owner: b.owner.name.split(/\s+/)[0], cargo: b.cargoParty.name.split(/\s+/)[0], status: b.case.status, statusLine: b.case.statusLine } : null;
} });

export const map = query({ args: { ...args, at: v.optional(v.number()) }, returns: v.any(), handler: async (ctx, { caseCode, at }): Promise<RoomMap | null> => {
  const b = await bundleFor(ctx, caseCode); if (!b) return null;
  const simNow = await getSimNow(ctx, DEMO_NS), viewAt = Math.min(at ?? simNow, simNow);
  const all = (await ctx.db.query("aisPoints").withIndex("by_vessel_at", q => q.eq("ns", DEMO_NS).eq("vesselId", b.vessel._id).gte("at", b.voyage.eta - 5 * DAY).lte("at", simNow)).collect()).map(point => ({ at: point.at, lon: point.lon, lat: point.lat, sogKn: point.sogKn, cogDeg: point.cogDeg }));
  const known = all.filter(point => point.at <= viewAt), position = positionAt(all, viewAt), last = known.at(-1);
  const track = [...known];
  if (position && last && viewAt < (all.at(-1)?.at ?? 0) && viewAt > last.at) track.push({ ...last, ...position, at: viewAt });
  const facts = await currentFacts(ctx, DEMO_NS, b.case._id);
  const tender = factValue<{ at: number; documentCode: string; position: [number, number]; quote?: string }>(facts, "NOR_TENDERED");
  const validity = factValue<{ valid: boolean; distanceNm: number }>(facts, "NOR_VALIDITY");
  const clock = await ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", DEMO_NS)).first();
  return { simNow, viewAt, port: { code: b.port.code, name: b.port.name, anchorage: b.port.anchorage, berth: b.port.berth }, track,
    vesselNow: position && last ? { at: viewAt <= (all.at(-1)?.at ?? 0) ? viewAt : last.at, lon: position.lon, lat: position.lat, sogKn: last.sogKn, cogDeg: last.cogDeg, gap: position.gap } : null,
    gaps: detectAisGaps(all).filter(gap => gap.startAt < viewAt).map(gap => ({ ...gap, endAt: Math.min(gap.endAt, viewAt) })),
    shifting: intervalFacts(facts).filter(interval => interval.kind === "SHIFTING" && interval.startAt < viewAt).map(interval => ({ startAt: interval.startAt, endAt: Math.min(interval.endAt, viewAt) })),
    nor: tender && validity && tender.at <= viewAt ? { at: tender.at, lon: tender.position[0], lat: tender.position[1], valid: validity.valid, distanceNm: validity.distanceNm, evidence: await evidenceViews(ctx, [{ kind: "DOC", documentId: tender.documentCode, ...(tender.quote ? { quote: tender.quote } : {}) }]) } : null,
    clockJump: clock?.prevSimNow !== undefined && clock.changedAtWall !== undefined ? { from: clock.prevSimNow, atWall: clock.changedAtWall } : null };
} });

export const documents = query({ args, returns: v.any(), handler: async (ctx, { caseCode }): Promise<DocumentView[]> => {
  const b = await bundleFor(ctx, caseCode); if (!b) return [];
  return Promise.all((await visibleDocuments(ctx, b)).map(doc => documentView(ctx, doc)));
} });

export const timeline = query({ args, returns: v.any(), handler: async (ctx, { caseCode }): Promise<TimelineView | null> => {
  const b = await bundleFor(ctx, caseCode); if (!b) return null;
  const now = await getSimNow(ctx, DEMO_NS), facts = await currentFacts(ctx, DEMO_NS, b.case._id), intervals = intervalFacts(facts);
  const points = await ctx.db.query("aisPoints").withIndex("by_vessel_at", q => q.eq("ns", DEMO_NS).eq("vesselId", b.vessel._id).gte("at", b.voyage.eta - 5 * DAY).lte("at", now)).collect();
  const completion = factValue<{ at: number }>(facts, "COMPLETION")?.at;
  const firstInPort = points.find(point => pointInPolygon([point.lon, point.lat], b.port.anchorage));
  const startAt = (firstInPort?.at ?? points[0]?.at ?? b.case.openedAt) - 6 * HOUR, endAt = Math.max(now, completion ?? now) + 6 * HOUR;
  const ais: TimelineBand[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], p = points[i];
    const kind = p.at - a.at > HOUR ? "Gap" : intervals.some(interval => interval.kind === "SHIFTING" && interval.startAt <= a.at && interval.endAt >= p.at) ? "Shifting" : a.sogKn >= 1 ? "Underway" : pointInPolygon([a.lon, a.lat], b.port.berth) ? "Berthed" : pointInPolygon([a.lon, a.lat], b.port.anchorage) ? "Anchored" : "Drifting";
    const previous = ais.at(-1);
    if (previous?.kind === kind && previous.to === a.at) previous.to = p.at;
    else ais.push({ from: a.at, to: p.at, label: kind, kind });
  }
  const lanes: TimelineView["lanes"] = [{ name: "AIS", bands: ais }];
  for (const side of ["PAYABLE", "RECOVERABLE"] as const) {
    const start = factValue<{ at: number }>(facts, side === "PAYABLE" ? "LAYTIME_START_PAYABLE" : "LAYTIME_START_RECOVERABLE")?.at;
    const contract = side === "PAYABLE" ? b.charter : b.cargo;
    const stored = await latestStatement(ctx, DEMO_NS, b.case._id, side);
    const until = Math.min(completion ?? now, now);
    const statement = stored ?? (start !== undefined && until > start ? computeStatement({ side, terms: contract.terms, formCode: contract.formCode, contractId: contract.code, laytimeStartAt: start, completionAt: until, intervals: intervals.filter(interval => interval.startAt < until).map(interval => ({ ...interval, kind: interval.kind as never, endAt: Math.min(interval.endAt, until), evidence: [] })), fees: [], edits: [], overrides: await activeOverrides(ctx, DEMO_NS, contract.formCode) }) : null);
    const bands: TimelineBand[] = [];
    if (start !== undefined && until > start) {
      const demurrage = statement?.totals.onDemurrageAt;
      bands.push({ from: start, to: Math.min(demurrage ?? until, until), kind: "LAYTIME", label: "Laytime" });
      if (demurrage !== undefined && demurrage < until) bands.push({ from: demurrage, to: until, kind: "DEMURRAGE", label: "Demurrage" });
      for (const line of statement?.lines ?? []) if (line.startAt !== undefined && line.endAt !== undefined && ["EXCLUDE", "HALF", "UNVERIFIED"].includes(line.treatment)) bands.push({ from: line.startAt, to: Math.min(line.endAt, until), label: line.note, kind: line.kind, treatment: line.treatment, ...(line.clause ? { clause: line.clause } : {}) });
    }
    lanes.push({ name: side === "PAYABLE" ? "Charter" : "Sale", bands });
  }
  lanes.push({ name: "Docs", bands: [] });
  const periods = (await ctx.db.query("periods").withIndex("by_ns", q => q.eq("ns", DEMO_NS)).collect()).filter(period => period.endAt >= startAt && period.startAt <= endAt);
  lanes.push({ name: "Period", bands: periods.map(period => ({ from: Math.max(startAt, period.startAt), to: Math.min(endAt, period.endAt), label: `${new Date(period.startAt).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}${period.status === "LOCKED" ? " · Locked" : ""}`, kind: period.status })) });
  const docs: TimelineView["docs"] = [];
  const abbrev: Record<string, string> = { NOR: "N", SOF: "S", OWNER_INVOICE: "I", PORT_CLOSURE: "H", PORT_ADVISORY: "H", CUSTOMS_HOLD: "C", CUSTOMS_RELEASE: "C", LAYTIME_STATEMENT: "L", RECOVERY_CLAIM: "L", DISPUTE_LETTER: "L" };
  for (const doc of await visibleDocuments(ctx, b)) if (doc.receivedAt !== undefined && abbrev[doc.kind]) {
    const fact = facts.find(fact => fact.evidence.some(ref => ref.kind === "DOC" && ref.documentId === doc.code && ref.quote));
    const evidence = fact?.evidence.find(ref => ref.kind === "DOC" && ref.documentId === doc.code && ref.quote);
    docs.push({ at: doc.receivedAt, label: abbrev[doc.kind], document: await documentView(ctx, doc), ...(evidence?.kind === "DOC" && evidence.quote ? { quote: evidence.quote } : {}) });
  }
  return { startAt, endAt, simNow: now, lanes, docs };
} });

const TOOL_LABELS: Record<string, string> = { record_step: "Recorded step", get_case_snapshot: "Read case", list_fleet: "Checked fleet", open_case: "Opened case", search_mailbox: "Searched mailbox", read_document: "Read document", get_ais: "Checked AIS", check_nor: "Checked NOR", convert_local_times: "Converted times", record_intervals: "Recorded timeline", search_customs_portal: "Searched customs portal", verify_hold: "Verified release", get_contract_terms: "Read contract register", compute_statement: "Computed laytime", reconcile_invoice: "Reconciled invoice", post_accrual: "Posted accrual", post_ap: "Posted payable", file_recovery: "Filed recovery", create_ask: "Asked for a decision", search_memory: "Checked memory" };
export const thinking = query({ args, returns: v.any(), handler: async (ctx, { caseCode }): Promise<{ now: StepView | null; done: StepView[] }> => {
  const b = await bundleFor(ctx, caseCode); if (!b) return { now: null, done: [] };
  const tasks = await ctx.db.query("agentTasks").withIndex("by_case", q => q.eq("ns", DEMO_NS).eq("caseId", b.case._id)).collect();
  const steps = (await ctx.db.query("agentSteps").withIndex("by_case_seq", q => q.eq("ns", DEMO_NS).eq("caseId", b.case._id)).collect()).sort((a, b) => b.wallAt - a.wallAt || b.seq - a.seq);
  const views: StepView[] = [];
  for (const step of steps) views.push({ key: `${step.taskId}:${step.seq}`, title: step.title, status: step.status, ...(step.observation ? { observation: step.observation } : {}), ...(step.check ? { check: step.check } : {}), ...(step.conclusion ? { conclusion: step.conclusion } : {}), evidence: await evidenceViews(ctx, step.evidence), memories: step.memoryRefs, deltaCents: step.deltaCents ?? null, at: step.simAt, tools: [...new Set(step.toolCalls.filter(call => call.tool !== "record_step").map(call => `${TOOL_LABELS[call.tool] ?? "Checked source"}${call.allowed ? "" : " · denied"}`))] });
  const running = steps.findIndex(step => step.status === "RUNNING" && tasks.some(task => task._id === step.taskId && task.state === "RUNNING"));
  return { now: running >= 0 ? views[running] : null, done: views.filter((_, index) => index !== running) };
} });

export const memory = query({ args, returns: v.any(), handler: async (ctx, { caseCode }): Promise<MemoryView[]> => {
  const b = await bundleFor(ctx, caseCode); if (!b) return [];
  const all = (await ctx.db.query("memoryItems").withIndex("by_ns", q => q.eq("ns", DEMO_NS)).collect()).sort((a, b) => b.createdAt - a.createdAt);
  const items = all.filter((item, index) => item.sourceCaseId === b.case._id || item.usedIn.includes(b.case._id) || index < 5);
  const result: MemoryView[] = [];
  for (const item of items) {
    const persona = item.sourcePersonaId ? await ctx.db.get(item.sourcePersonaId) : null;
    const usedIn = [];
    for (const id of item.usedIn) { const c = await ctx.db.get(id); const voyage = c ? await ctx.db.get(c.voyageId) : null; const vessel = voyage ? await ctx.db.get(voyage.vesselId) : null; if (c && vessel) usedIn.push({ code: c.code, vessel: vessel.name.replace(/^MV\s+/, "") }); }
    result.push({ code: item.code, title: item.title, kind: item.kind, status: item.status, group: item.sourceCaseId === b.case._id ? "Learned here" : item.usedIn.includes(b.case._id) ? "Used here" : "Recent", from: item.origin === "AUTOMATED_TEST" ? "Automated test" : persona?.displayName ?? null, at: item.createdAt, wallCreatedAt: item.newAtWall ?? item._creationTime, newEligible: item.origin !== "HISTORY_IMPORT" && !["PENDING_TEACHBACK","PROPOSED"].includes(item.status), usedIn, reason: item.gateDecision?.reason ?? null });
  }
  return result;
} });

export const openAsk = query({ args, returns: v.any(), handler: async (ctx, { caseCode }): Promise<AskView | null> => {
  const b = await bundleFor(ctx, caseCode); if (!b) return null;
  const asks = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", DEMO_NS).eq("caseId", b.case._id)).collect();
  const ask = asks.find(ask => ask.status === "OPEN"); if (!ask) return null;
  const now = await getSimNow(ctx, DEMO_NS);
  return { code: ask.code, kind: ask.kind, role: ask.role, question: ask.question, shortQuestion: ask.kind === "CONFIRM_FACT" ? `${ask.question.split("?")[0]}?` : ask.kind === "PAYMENT_APPROVAL" ? "Review payable and dispute" : ask.question.replace(/\$[\d,.]+\s*/g, ""), amountAtRiskCents: ask.amountAtRiskCents ?? null, ...(["TEACH_BACK","APPROVE_MEMORY"].includes(ask.kind) ? { memoryCode: ask.subject } : {}), ageDays: Math.max(0, Math.ceil((now - ask.createdAt) / DAY)) };
} });

export const money = query({ args, returns: v.any(), handler: async (ctx, { caseCode }): Promise<RoomMoney | null> => {
  const b = await bundleFor(ctx, caseCode); if (!b) return null;
  const now = await getSimNow(ctx, DEMO_NS);
  const filings = await ctx.db.query("filings").withIndex("by_case", q => q.eq("ns", DEMO_NS).eq("caseId", b.case._id)).collect();
  const claim = filings.find(filing => ["RECOVERY_CLAIM", "PROTECTIVE_NOTICE"].includes(filing.kind));
  const entries = await ctx.db.query("journalEntries").withIndex("by_case", q => q.eq("ns", DEMO_NS).eq("caseId", b.case._id)).collect();
  const filed = Boolean(claim) || entries.some(entry => entry.kind === "AR_RECOVERY");
  const reconciliation = b.case.reconciliation as { payableCents?: number } | undefined;
  const owe = reconciliation?.payableCents ?? b.case.payable?.totalCents ?? null, recovery = claim?.cents ?? b.case.recoverable?.totalCents ?? null;
  const timeBarAt = await caseTimeBar(ctx, b.case, b.cargo);
  return { version: `${b.case.updatedAt}:${b.case.payable?.version ?? 0}:${b.case.recoverable?.version ?? 0}`, billedCents: b.case.billedCents ?? null, oweCents: owe, recoverCents: recovery, netCents: owe === null || recovery === null ? null : recovery - owe, payableState: entries.some(entry => entry.kind === "AP") ? "approved" : "est.", recoveryState: filed ? "filed" : "est.", waivedCents: claim && b.case.recoverable ? Math.max(0, b.case.recoverable.totalCents - claim.cents) : 0, timeBar: { at: timeBarAt, days: timeBarAt !== null && !filed ? Math.max(0, Math.ceil((timeBarAt - now) / DAY)) : null, filed } };
} });

export const statement = query({ args: { ...args, side: v.union(v.literal("PAYABLE"), v.literal("RECOVERABLE")) }, returns: v.any(), handler: async (ctx, { caseCode, side }) => {
  const b = await bundleFor(ctx, caseCode); if (!b) return null;
  const item = await latestStatement(ctx, DEMO_NS, b.case._id, side);
  if (!item) return null;
  return { version: item.version, side, lines: await Promise.all(item.lines.map(async line => ({ id: line.id, kind: line.kind, startAt: line.startAt ?? null, endAt: line.endAt ?? null, minutes: line.minutes, treatment: line.treatment, countedMinutes: line.countedMinutes, note: line.note, clause: line.clause ?? null, evidence: await evidenceViews(ctx, line.evidence) }))), totals: item.totals };
} });

export const workSurface = query({ args, returns: v.any(), handler: async (ctx, { caseCode }) => {
  const b = await bundleFor(ctx, caseCode); if (!b) return { mode: "MAP" as const };
  const acting = await currentPersona(ctx), role = acting?.persona.role ?? "observer";
  const asks = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", DEMO_NS).eq("caseId", b.case._id)).collect();
  const ask = asks.find(ask => ask.status === "OPEN" && ask.role === role && ["CONFIRM_FACT", "PAYMENT_APPROVAL", "COMMERCIAL_DECISION"].includes(ask.kind));
  return { mode: !ask ? "MAP" as const : ask.kind === "CONFIRM_FACT" ? "OPS_DESK" as const : ask.kind === "PAYMENT_APPROVAL" ? "STATEMENT" as const : ask.kind === "COMMERCIAL_DECISION" ? "RECOVERY" as const : "MAP" as const };
} });

/** Data for V08's deterministic Why action; V11 adds phrasing within this same citation graph. */
export async function whyData(ctx: QueryCtx, caseCode: string, field: string) {
  const b = await bundleFor(ctx, caseCode); if (!b) return { text: "No case evidence yet.", citations: [] as EvidenceView[] };
  const facts = await currentFacts(ctx, DEMO_NS, b.case._id);
  const statements = await Promise.all((field === "NET" ? ["PAYABLE", "RECOVERABLE"] as const : [field === "RECOVERABLE" ? "RECOVERABLE" : "PAYABLE"] as const).map(side => latestStatement(ctx, DEMO_NS, b.case._id, side)));
  const filings = await ctx.db.query("filings").withIndex("by_case", q => q.eq("ns", DEMO_NS).eq("caseId", b.case._id)).collect();
  const claim = filings.find(filing => ["RECOVERY_CLAIM", "PROTECTIVE_NOTICE"].includes(filing.kind));
  const refs = [...facts.flatMap(fact => fact.evidence), ...filings.flatMap(filing => filing.authority.kind === "APPROVAL" ? [{ kind: "ASK" as const, askId: String(filing.authority.askId) }] : [])];
  if (b.case.invoiceDocumentId) { const doc = await ctx.db.get(b.case.invoiceDocumentId); if (doc) refs.push({ kind: "DOC", documentId: doc.code }); }
  const graph = buildProvenance({ type: "CASE_TOTAL", id: caseCode, field }, { lines: statements.flatMap(statement => statement?.lines ?? []) });
  if (field === "BILLED" && b.case.billedCents === undefined) return { text: "No owner invoice has arrived for this case.", citations: [] };
  const text = field === "NET" ? "Net is the filed or estimated recovery less the recorded payable. The two sides follow their own contracts and evidence." : field === "BILLED" ? "The amount is read from the owner's invoice. It is reconciled against the recorded laytime and contract terms." : field === "TIME_BAR" ? "The claim deadline runs from completion under the cargo contract. A filed claim records its filing time and authority." : field === "RECOVERABLE" && claim ? "The recovery is the recorded claim filed under its recorded authority. Any commercial reduction is kept with the claim decision." : templateExplanation(graph) || "The agent has not established a statement yet.";
  return { text, citations: await evidenceViews(ctx, [...graph.citations, ...refs]), provenance: { ...graph, citations: [...graph.citations, ...refs] }, amount: { billedCents:b.case.billedCents??null, payableCents:(b.case.reconciliation as {payableCents?:number}|undefined)?.payableCents??b.case.payable?.totalCents??null, recoverableCents:claim?.cents??b.case.recoverable?.totalCents??null } };
}

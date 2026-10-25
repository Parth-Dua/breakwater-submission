import { v } from "convex/values";
import { query } from "./_generated/server";
import { getClock, getSimNow } from "./lib/clock";
import { readLedger } from "./books";
import { sumCents } from "../src/domain/money";
import { DEMO_NS, type Role } from "../src/world/personas";

import { caseTimeBar } from "./views/timeBar";

const DAY = 86_400_000;
export type PeriodView = { code: string; status: "OPEN" | "LOCKED"; lockAt?: number };
export type DeskSummary = { kpis: { oweCents: number; recoverableCents: number; netCents: number; timeBars: number }; periods: PeriodView[]; clock: { simNow: number; status: "RUNNING" | "HELD" | "IDLE"; holdReason?: string } | null };
export type CaseRow = { key: string; code: string | null; provisional: boolean; vessel: string; port: string; owner: string; cargo: string; status: string; statusLine: string; oweCents: number | null; recoverCents: number | null; netCents: number | null; recoveryFiled: boolean; daysToTimeBar: number | null; updatedAt: number; openedAt: number; closed: boolean };
export type AskRow = { code: string; caseCode: string; vessel: string; role: Role; question: string; kind: string; ageDays: number; amountAtRiskCents: number | null };
export type MemoryRow = { code: string; title: string; kind: string; status: string; at: number };

export const summary = query({
  args: {}, returns: v.any(),
  handler: async (ctx): Promise<DeskSummary> => {
    const ns = DEMO_NS, ledger = await readLedger(ctx, ns), clock = await getClock(ctx, ns);
    const date = new Date(ledger.now), quarterStart = Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1);
    const quarterEntries = new Set(ledger.entries.filter(entry => entry.postedAt >= quarterStart).map(entry => String(entry._id)));
    const quarterCost = sumCents(ledger.lines.filter(line => quarterEntries.has(String(line.entryId)) && ["5100", "5190"].includes(line.account)).map(line => line.side === "DEBIT" ? line.cents : -line.cents));
    const cases = await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", ns)).collect();
    const filings = await ctx.db.query("filings").withIndex("by_ns", q => q.eq("ns", ns)).collect();
    const deadlines = await Promise.all(cases.map(async item => ({ item, at: await caseTimeBar(ctx, item) })));
    const timeBars = deadlines.filter(({ item, at }) => item.status !== "CLOSED" && at !== null && at >= ledger.now && at - ledger.now < 7 * DAY && !filings.some(filing => filing.caseId === item._id && ["RECOVERY_CLAIM", "PROTECTIVE_NOTICE"].includes(filing.kind))).length;
    const periods = (await ctx.db.query("periods").withIndex("by_ns", q => q.eq("ns", ns)).collect()).sort((a, b) => a.startAt - b.startAt).map(period => ({ code: period.code, status: period.status, ...(period.lockAt !== undefined ? { lockAt: period.lockAt } : {}) }));
    return { kpis: { oweCents: -ledger.signed("2000") - ledger.signed("2150"), recoverableCents: ledger.signed("1200"), netCents: -quarterCost, timeBars }, periods,
      clock: clock ? { simNow: clock.simNow, status: clock.status, ...(clock.holdReason ? { holdReason: clock.holdReason } : {}) } : null };
  },
});

export const cases = query({
  args: {}, returns: v.any(),
  handler: async (ctx): Promise<CaseRow[]> => {
    const ns = DEMO_NS, now = await getSimNow(ctx, ns);
    const items = await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", ns)).collect();
    const tasks = await ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", ns)).collect();
    const steps = await ctx.db.query("agentSteps").withIndex("by_ns", q => q.eq("ns", ns)).collect();
    const filings = await ctx.db.query("filings").withIndex("by_ns", q => q.eq("ns", ns)).collect();
    const asks = await ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", ns)).collect();
    const rows: CaseRow[] = [];
    for (const item of items.filter(item => item.openedAt <= now)) {
      const voyage = (await ctx.db.get(item.voyageId))!, vessel = (await ctx.db.get(voyage.vesselId))!, port = (await ctx.db.get(voyage.portId))!;
      const charter = (await ctx.db.get(voyage.charterId))!, cargo = (await ctx.db.get(voyage.cargoContractId))!;
      const owner = (await ctx.db.get(charter.counterpartyId))!, party = (await ctx.db.get(cargo.counterpartyId))!;
      const active = tasks.filter(task => task.caseId === item._id && ["QUEUED", "RUNNING"].includes(task.state));
      const caseSteps = steps.filter(step => step.caseId === item._id).sort((a, b) => b.wallAt - a.wallAt || b.seq - a.seq);
      const current = caseSteps.find(step => active.some(task => task._id === step.taskId));
      const recovery = filings.find(filing => filing.caseId === item._id && ["RECOVERY_CLAIM", "PROTECTIVE_NOTICE"].includes(filing.kind));
      const reconciliation = item.reconciliation as { payableCents?: number } | undefined;
      const oweCents = reconciliation?.payableCents ?? item.payable?.totalCents ?? null, recoverCents = recovery?.cents ?? item.recoverable?.totalCents ?? null;
      const timeBarAt = await caseTimeBar(ctx, item, cargo);
      const caseAsks = asks.filter(ask => ask.caseId === item._id);
      rows.push({ key: voyage.code, code: item.code, provisional: false, vessel: vessel.name.replace(/^MV\s+/, ""), port: port.name, owner: owner.name.split(/\s+/)[0], cargo: party.name.split(/\s+/)[0], status: active.length ? "WORKING" : item.status,
        statusLine: (active.length ? current?.title ?? "Queued" : item.statusLine).slice(0, 48), oweCents, recoverCents, netCents: oweCents === null || recoverCents === null ? null : recoverCents - oweCents,
        recoveryFiled: Boolean(recovery), daysToTimeBar: timeBarAt !== null && !recovery ? Math.max(0, Math.ceil((timeBarAt - now) / DAY)) : null,
        updatedAt: Math.max(item.openedAt, item.closedAt ?? 0, ...caseSteps.map(step => step.simAt), ...caseAsks.map(ask => ask.answeredAt ?? ask.createdAt), ...filings.filter(filing => filing.caseId === item._id).map(filing => filing.filedAt)), openedAt: item.openedAt, closed: item.status === "CLOSED" });
    }
    // An existing fleet-scan task is live work even while its provider call is pending.
    // Project only real port/ETA candidates; amounts and case navigation wait for open_case.
    const voyages = await ctx.db.query("voyages").withIndex("by_ns", q => q.eq("ns", ns)).collect();
    for (const task of tasks.filter(task => task.kind === "FLEET_SCAN" && ["QUEUED", "RUNNING", "FAILED", "NEEDS_REVIEW"].includes(task.state))) {
      const event = task.triggerEventId ? await ctx.db.get(task.triggerEventId) : null;
      const portCode = (event?.payload as { portCode?: string } | undefined)?.portCode;
      if (!portCode) continue;
      const port = await ctx.db.query("ports").withIndex("by_code", q => q.eq("ns", ns).eq("code", portCode)).unique();
      if (!port) continue;
      for (const voyage of voyages.filter(voyage => voyage.portId === port._id && Math.abs(voyage.eta - now) <= 72 * 3_600_000 && !rows.some(row => row.key === voyage.code))) {
        const vessel = (await ctx.db.get(voyage.vesselId))!, charter = (await ctx.db.get(voyage.charterId))!, cargo = (await ctx.db.get(voyage.cargoContractId))!;
        const owner = (await ctx.db.get(charter.counterpartyId))!, party = (await ctx.db.get(cargo.counterpartyId))!;
        const step = steps.filter(step => step.taskId === task._id).sort((a, b) => b.wallAt - a.wallAt || b.seq - a.seq)[0];
        const busy = ["QUEUED", "RUNNING"].includes(task.state);
        rows.push({ key: voyage.code, code: null, provisional: true, vessel: vessel.name.replace(/^MV\s+/, ""), port: port.name, owner: owner.name.split(/\s+/)[0], cargo: party.name.split(/\s+/)[0], status: busy ? "WORKING" : "NEEDS_REVIEW", statusLine: busy ? step?.title.slice(0, 48) ?? "Queued" : "Scan needs review", oweCents: null, recoverCents: null, netCents: null, recoveryFiled: false, daysToTimeBar: null, updatedAt: step?.simAt ?? event?.scheduledAt ?? now, openedAt: event?.scheduledAt ?? now, closed: false });
      }
    }
    const rank: Record<string, number> = { WORKING: 0, WAITING_HUMAN: 1, NEEDS_REVIEW: 2, OPEN: 3, WAITING_EXTERNAL: 4, CLOSED: 5 };
    return rows.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || b.updatedAt - a.updatedAt);
  },
});

export const waitingOnPeople = query({
  args: {}, returns: v.any(),
  handler: async (ctx): Promise<Record<Role, AskRow[]>> => {
    const ns = DEMO_NS, now = await getSimNow(ctx, ns), result: Record<Role, AskRow[]> = { agent: [], observer: [], ops: [], controller: [], trader: [] };
    const asks = (await ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", ns)).collect()).filter(ask => ask.status === "OPEN").sort((a, b) => a.createdAt - b.createdAt);
    for (const ask of asks) {
      const item = (await ctx.db.get(ask.caseId))!, voyage = (await ctx.db.get(item.voyageId))!, vessel = (await ctx.db.get(voyage.vesselId))!;
      result[ask.role].push({ code: ask.code, caseCode: item.code, vessel: vessel.name.replace(/^MV\s+/, ""), role: ask.role, kind: ask.kind, question: ask.question, ageDays: Math.max(0, Math.ceil((now - ask.createdAt) / DAY)), amountAtRiskCents: ask.amountAtRiskCents ?? null });
    }
    return result;
  },
});

export const learnedRecently = query({
  args: { limit: v.optional(v.number()) }, returns: v.any(),
  handler: async (ctx, { limit }): Promise<MemoryRow[]> => (await ctx.db.query("memoryItems").withIndex("by_ns", q => q.eq("ns", DEMO_NS)).collect()).sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.min(5, Math.max(0, Math.floor(limit ?? 5)))).map(item => ({ code: item.code, title: item.title, kind: item.kind, status: item.status, at: item.createdAt })),
});

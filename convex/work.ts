import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { currentPersona } from "./lib/persona";
import { caseByCode, loadCase } from "./agent/state";
import { automationArg, askForHuman, linkedEvidence, eventsFor, startHuman } from "./human";
import { evidenceViews } from "./room";
import { getSimNow } from "./lib/clock";

export const start = mutation({ args: { askCode: v.string(), ...automationArg }, returns: v.null(), handler: async (ctx, { askCode, automation }) => {
  const { ask, acting } = await askForHuman(ctx, askCode);
  await startHuman(ctx, ask, acting, automation); return null;
} });
export const surface = query({ args: { caseCode: v.string() }, returns: v.any(), handler: async (ctx, { caseCode }) => {
  const acting = await currentPersona(ctx), item = await caseByCode(ctx, "demo", caseCode);
  if (!acting || !item || acting.persona.role === "observer") return null;
  const ask = (await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", "demo").eq("caseId", item._id)).collect()).find(ask => ask.status === "OPEN" && ask.role === acting.persona.role && ["CONFIRM_FACT", "PAYMENT_APPROVAL", "COMMERCIAL_DECISION"].includes(ask.kind));
  if (!ask) return null;
  const b = await loadCase(ctx, item._id), now = await getSimNow(ctx, "demo");
  const linked = linkedEvidence(await eventsFor(ctx, ask), acting.persona._id);
  const recent = [];
  const voyages = await ctx.db.query("voyages").withIndex("by_ns", q => q.eq("ns", "demo")).collect();
  for (const c of (await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", "demo")).collect()).filter(c => c.status === "CLOSED" && c.closedAt !== undefined && c.closedAt <= now && c._id !== item._id).sort((a,b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))) {
    const voyage = voyages.find(voyage => voyage._id === c.voyageId), contract = voyage ? await ctx.db.get(voyage.cargoContractId) : null;
    if (contract?.counterpartyId === b.cargoParty._id) recent.push({ code: c.code, at: c.closedAt, cents: c.recoverable?.totalCents ?? null, outcome: c.statusLine });
    if (recent.length === 3) break;
  }
  return { code: ask.code, kind: ask.kind, question: ask.question.split("?")[0] + (ask.kind === "CONFIRM_FACT" ? "?" : ""), subject: ask.subject, options: ask.options, amountAtRiskCents: ask.amountAtRiskCents ?? null, deadlineAt: ask.deadlineAt ?? null, vessel: b.vessel.name.replace(/^MV\s+/, ""), counterparty: b.cargoParty.name, strategic: b.cargoParty.strategic, linked, linkedViews: await evidenceViews(ctx, linked), recent, simNow: now };
} });
export const teachBack = query({ args: { caseCode: v.string() }, returns: v.any(), handler: async (ctx, { caseCode }) => {
  const acting = await currentPersona(ctx), item = await caseByCode(ctx, "demo", caseCode);
  if (!acting || !item) return null;
  const ask = (await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", "demo").eq("caseId", item._id)).collect()).find(ask => ask.kind === "TEACH_BACK" && ask.status === "OPEN" && ask.role === acting.persona.role);
  return ask ? { code: ask.code, options: ask.options } : null;
} });


/** Read-back for CLI acceptance artifacts; never a browser work endpoint. */
export const evidence = internalQuery({ args: { since: v.number() }, returns: v.any(), handler: async (ctx, { since }) => {
  const clock = await ctx.db.query("simClock").withIndex("by_ns", q => q.eq("ns", "demo")).first();
  const tasks = await ctx.db.query("agentTasks").withIndex("by_ns", q => q.eq("ns", "demo")).collect();
  const events = await ctx.db.query("humanEvents").withIndex("by_ns", q => q.eq("ns", "demo")).collect();
  const cases = await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", "demo")).collect();
  const asks = await ctx.db.query("asks").withIndex("by_ns", q => q.eq("ns", "demo")).collect();
  return { clockStatus: clock?.status, simNow: clock?.simNow, tasks: tasks.filter(task => task.createdAt >= since).map(task => ({ kind: task.kind, state: task.state, model: task.model ?? null, tokensIn: task.tokensIn ?? 0, tokensOut: task.tokensOut ?? 0, error: task.error ?? null })), events: events.filter(event => event.wallAt >= since).sort((a,b) => a.wallAt - b.wallAt || a.seq - b.seq).map(event => ({ askCode: asks.find(ask => ask._id === event.askId)?.code, type: event.type, origin: event.origin, seq: event.seq, payload: event.payload })), asks: asks.map(ask => ({ code: ask.code, caseCode: cases.find(c => c._id === ask.caseId)?.code, kind: ask.kind, status: ask.status, answer: ask.answer ?? null })) };
} });

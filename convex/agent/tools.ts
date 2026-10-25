// Deterministic agent tools (CONTRACTS §10.3). Claude decides which to call; these functions decide what is true.
// Writes require the task's lease token. Reads go through capabilities. Money goes through the gateway.
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { appendAudit } from "../lib/audit";
import { getSimNow } from "../lib/clock";
import { fail } from "../lib/errors";
import { scheduleTask } from "../orchestrator";
import { createAskTx, fileRecoveryTx, loadPolicies, periodAt, postJournalTx, recordDisputeTx } from "../gateway";
import { aisWindow, getDocument, searchCustomsPortal, searchMailbox, type ReadScope } from "../sources/read";
import { accruedCents, activeOverrides, apPosted, capabilitiesFor, currentFacts, factValue, intervalFacts, latestStatement, loadCase, statusLineFor, type CaseBundle } from "./state";
import { detectAisGaps, detectGeofenceEntry, detectMovementIntervals, distanceToPolygonNm, pointInPolygon, positionAt, type AisPoint } from "../../src/domain/geo";
import { computeStatement, type EvidenceRef, type IntervalInput } from "../../src/domain/laytime";
import { buildAccrual, buildReversalAndAp } from "../../src/domain/ledger";
import { formatUsd, proRataCents } from "../../src/domain/money";
import { evaluateNor } from "../../src/domain/nor";
import { parseHoursToMinutes, parseMoney, parseUtcDateTime, parseUtcDateTimes } from "../../src/domain/parse";
import { belowMateriality, deadlineFallbackDue, routeAsk, type Need } from "../../src/domain/policy";
import { reconcileInvoice, type ExtractedInvoice } from "../../src/domain/reconcile";
import { localToUtc, sofTextToIso } from "../../src/domain/time";
import type { ContractTerms } from "../../src/world/types";

const DAY = 86_400_000, HOUR = 3_600_000;
const toolArgs = { taskId: v.id("agentTasks"), token: v.string(), input: v.any() };

// ---------------------------------------------------------------- task / lease helpers
async function taskFor(ctx: QueryCtx, taskId: Id<"agentTasks">, token: string) {
  const task = await ctx.db.get(taskId);
  if (!task || task.state !== "RUNNING" || task.leaseToken !== token || (task.leaseUntil ?? 0) <= Date.now()) fail("STALE_VERSION", "Task lease is no longer held");
  return task;
}
async function caseFor(ctx: QueryCtx, task: Doc<"agentTasks">, caseCode?: unknown): Promise<CaseBundle> {
  let caseId = task.caseId;
  if (!caseId && typeof caseCode === "string") caseId = (await ctx.db.query("cases").withIndex("by_code", q => q.eq("ns", task.ns).eq("code", caseCode)).unique())?._id;
  if (!caseId) fail("NOT_PERMITTED", "This task has no case; pass caseCode");
  return loadCase(ctx, caseId);
}
async function scopeFor(ctx: QueryCtx, task: Doc<"agentTasks">, bundle: CaseBundle): Promise<ReadScope> {
  const { capabilities, context } = await capabilitiesFor(ctx, task.ns, bundle.case._id);
  return { ns: task.ns, capabilities, context: context!, simNow: await getSimNow(ctx, task.ns) };
}
const actorOf = (task: Doc<"agentTasks">, bundle?: CaseBundle) => ({ actor: `agent:${task._id}`, role: "agent" as const, correlationId: bundle?.case.correlationId ?? `task:${task._id}` });

async function currentStep(ctx: QueryCtx, task: Doc<"agentTasks">) {
  const steps = await ctx.db.query("agentSteps").withIndex("by_task", q => q.eq("ns", task.ns).eq("taskId", task._id)).collect();
  return steps.length ? steps[steps.length - 1] : null;
}
/** Money changes are attached to the visible step by the tool, never relayed through the model (REQ-AGT-03). */
async function attachDelta(ctx: MutationCtx, task: Doc<"agentTasks">, deltaCents: number) {
  if (!deltaCents) return;
  const step = await currentStep(ctx, task);
  if (step) await ctx.db.patch(step._id, { deltaCents: (step.deltaCents ?? 0) + deltaCents });
}
/** One reference per document / AIS window; a quoted reference replaces an unquoted one. */
function mergeEvidence(existing: EvidenceRef[], added: EvidenceRef[]): EvidenceRef[] {
  const key = (ref: EvidenceRef) => ref.kind === "DOC" ? `DOC:${ref.documentId}` : JSON.stringify(ref);
  const merged = new Map<string, EvidenceRef>();
  for (const ref of [...existing, ...added]) {
    const previous = merged.get(key(ref));
    if (!previous || (ref.kind === "DOC" && ref.quote && !(previous as { quote?: string }).quote)) merged.set(key(ref), ref);
  }
  return [...merged.values()].slice(0, 12);
}
async function attachEvidence(ctx: MutationCtx, task: Doc<"agentTasks">, evidence: EvidenceRef[]) {
  const step = await currentStep(ctx, task);
  if (step && evidence.length) await ctx.db.patch(step._id, { evidence: mergeEvidence(step.evidence, evidence) });
}

async function writeFact(ctx: MutationCtx, task: Doc<"agentTasks">, caseId: Id<"cases">, key: Doc<"facts">["key"], value: Record<string, unknown>, evidence: EvidenceRef[], at: number, sameAs?: (fact: Doc<"facts">) => boolean) {
  const facts = await currentFacts(ctx, task.ns, caseId);
  const previous = facts.filter(fact => fact.key === key && (sameAs ? sameAs(fact) : true));
  const id = await ctx.db.insert("facts", { ns: task.ns, origin: "AGENT", caseId, key, value, evidence, establishedBy: "AGENT", at });
  for (const fact of previous) await ctx.db.patch(fact._id, { supersededBy: id });
  return id;
}

// ---------------------------------------------------------------- steps
export const recordStep = internalMutation({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const simNow = await getSimNow(ctx, task.ns);
    const clip = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
    const evidence: EvidenceRef[] = [];
    for (const code of (input.evidenceDocs as string[] | undefined) ?? []) {
      const document = await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", task.ns).eq("code", code)).unique();
      if (document && (document.receivedAt === undefined || document.receivedAt <= simNow)) evidence.push({ kind: "DOC", documentId: code });
    }
    for (const key of ["title", "observation", "check", "conclusion"]) {
      if (typeof input[key] === "string" && MONEY_TEXT.test(input[key] as string)) fail("NOT_PERMITTED", "Steps must not state amounts; tools attach money to steps");
    }
    const fields = {
      title: clip(input.title, 60) ?? "Working", observation: clip(input.observation, 80), check: clip(input.check, 80), conclusion: clip(input.conclusion, 80),
    };
    const memoryRefs = ((input.memoryRefs as string[] | undefined) ?? []).filter(ref => typeof ref === "string").slice(0, 4);
    const last = await currentStep(ctx, task);
    if (input.status === "DONE" && last?.status === "RUNNING") {
      await ctx.db.patch(last._id, { status: "DONE", title: fields.title, ...(fields.observation ? { observation: fields.observation } : {}), ...(fields.check ? { check: fields.check } : {}), ...(fields.conclusion ? { conclusion: fields.conclusion } : {}), evidence: mergeEvidence(last.evidence, evidence), memoryRefs: [...new Set([...last.memoryRefs, ...memoryRefs])], simAt: simNow });
      return { stepId: last._id };
    }
    if (last?.status === "RUNNING") await ctx.db.patch(last._id, { status: "DONE" });
    const seq = (await ctx.db.query("agentSteps").withIndex("by_case_seq", q => q.eq("ns", task.ns).eq("caseId", task.caseId)).collect()).length + 1;
    const stepId = await ctx.db.insert("agentSteps", {
      ns: task.ns, origin: "AGENT", taskId, seq, status: input.status === "DONE" ? "DONE" : "RUNNING", ...fields, title: fields.title,
      evidence, memoryRefs, toolCalls: [], simAt: simNow, wallAt: Date.now(), ...(task.caseId ? { caseId: task.caseId } : {}),
    });
    return { stepId };
  },
});

export const appendToolCall = internalMutation({
  args: { taskId: v.id("agentTasks"), token: v.string(), log: v.object({ tool: v.string(), capability: v.optional(v.string()), allowed: v.boolean(), ms: v.number(), summary: v.string() }) },
  returns: v.null(),
  handler: async (ctx, { taskId, token, log }) => {
    const task = await taskFor(ctx, taskId, token);
    const step = await currentStep(ctx, task);
    if (step) await ctx.db.patch(step._id, { toolCalls: [...step.toolCalls, log].slice(-12) });
    if (!log.allowed) await appendAudit(ctx, { ns: task.ns, origin: "AGENT", actor: `agent:${task._id}`, role: "agent", type: "TOOL_DENIED", entityType: "agentTask", entityId: String(task._id), correlationId: `task:${task._id}`, details: log });
    return null;
  },
});

// ---------------------------------------------------------------- reads
export const snapshot = internalQuery({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const ns = task.ns, caseId = bundle.case._id;
    const simNow = await getSimNow(ctx, ns);
    const facts = await currentFacts(ctx, ns, caseId);
    const summarize = (statement: Doc<"statements"> | null) => statement && { version: statement.version, totalCents: statement.totals.totalCents, demurrageMinutes: statement.totals.demurrageMinutes, onDemurrageAt: statement.totals.onDemurrageAt, lines: statement.lines.map(line => ({ id: line.id, kind: line.kind, minutes: line.minutes, treatment: line.treatment, countedMinutes: line.countedMinutes, note: line.note })) };
    const asks = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
    const filings = await ctx.db.query("filings").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
    const memory = await ctx.db.query("memoryItems").withIndex("by_ns", q => q.eq("ns", ns)).collect();
    const mail = await ctx.db.query("mailMessages").withIndex("by_received", q => q.eq("ns", ns).lte("receivedAt", simNow)).collect();
    const documents = [];
    for (const message of mail.filter(message => message.vesselImo === bundle.vessel.imo)) {
      const document = message.documentId ? await ctx.db.get(message.documentId) : null;
      if (document) documents.push({ code: document.code, kind: document.kind, receivedAt: message.receivedAt, extracted: Boolean(await ctx.db.query("extractions").withIndex("by_document", q => q.eq("ns", ns).eq("documentId", document._id)).first()) });
    }
    const recoverable = bundle.cargo.terms.timeBar && factValue<{ at: number }>(facts, "COMPLETION") ? factValue<{ at: number }>(facts, "COMPLETION")!.at + bundle.cargo.terms.timeBar.days * DAY : undefined;
    return {
      simNow,
      case: { code: bundle.case.code, status: bundle.case.status, vessel: bundle.vessel.name, vesselCode: bundle.vessel.code, imo: bundle.vessel.imo, port: bundle.port.name, portCode: bundle.port.code, portZone: bundle.port.ianaZone, operation: bundle.voyage.operation, eta: bundle.voyage.eta },
      owner: { code: bundle.owner.code, name: bundle.owner.name },
      cargoCounterparty: { code: bundle.cargoParty.code, name: bundle.cargoParty.name, strategic: bundle.cargoParty.strategic, kind: bundle.cargoParty.kind },
      contracts: { charter: { code: bundle.charter.code, formCode: bundle.charter.formCode }, cargo: { code: bundle.cargo.code, formCode: bundle.cargo.formCode, kind: bundle.cargo.kind } },
      facts: facts.map(fact => ({ key: fact.key, value: fact.value, by: fact.establishedBy })),
      statements: { PAYABLE: summarize(await latestStatement(ctx, ns, caseId, "PAYABLE")), RECOVERABLE: summarize(await latestStatement(ctx, ns, caseId, "RECOVERABLE")) },
      documentsReceived: documents,
      openAsks: asks.filter(ask => ask.status === "OPEN").map(ask => ({ code: ask.code, kind: ask.kind, role: ask.role, question: ask.question })),
      answeredAsks: asks.filter(ask => ask.status === "ANSWERED").map(ask => ({ code: ask.code, kind: ask.kind, role: ask.role, question: ask.question, answer: ask.answer })),
      filings: filings.map(filing => ({ kind: filing.kind, cents: filing.cents, filedAt: filing.filedAt })),
      accruedCents: await accruedCents(ctx, ns, caseId), apPosted: await apPosted(ctx, ns, caseId),
      reconciliation: bundle.case.reconciliation ?? null,
      recoveryTimeBarAt: recoverable ?? null,
      memory: memory.filter(item => item.status === "ACTIVE" || item.status === "PRECEDENT_ONLY").map(item => ({ code: item.code, kind: item.kind, status: item.status, title: item.title })),
    };
  },
});

export const listFleet = internalQuery({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token }) => {
    const task = await taskFor(ctx, taskId, token);
    const simNow = await getSimNow(ctx, task.ns);
    const voyages = await ctx.db.query("voyages").withIndex("by_ns", q => q.eq("ns", task.ns)).collect();
    const rows = [];
    for (const voyage of voyages.filter(candidate => candidate.eta >= simNow - 2 * DAY)) {
      const vessel = await ctx.db.get(voyage.vesselId), port = await ctx.db.get(voyage.portId);
      const existing = await ctx.db.query("cases").withIndex("by_voyage", q => q.eq("ns", task.ns).eq("voyageId", voyage._id)).first();
      rows.push({ vesselCode: vessel?.code, vessel: vessel?.name, portCode: port?.code, port: port?.name, eta: voyage.eta, hoursToEta: Math.round((voyage.eta - simNow) / HOUR), caseCode: existing?.code ?? null });
    }
    return rows.sort((a, b) => a.eta - b.eta);
  },
});

export const searchMailboxTool = internalQuery({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const result = await searchMailbox(ctx, await scopeFor(ctx, task, bundle), { vesselId: bundle.vessel._id, ...(Array.isArray(input.kinds) ? { kinds: input.kinds as never } : {}) });
    return result;
  },
});

/** Document for extraction (Node side calls Claude, then saveExtraction). Capability-checked. */
export const documentForExtraction = internalQuery({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const { capabilityId, document } = await getDocument(ctx, await scopeFor(ctx, task, bundle), String(input.documentCode));
    const cached = await ctx.db.query("extractions").withIndex("by_document", q => q.eq("ns", task.ns).eq("documentId", document._id)).first();
    return { capabilityId, documentId: document._id, code: document.code, kind: document.kind, storageId: document.storageId, textLayer: document.textLayer, cached: cached ? { fields: cached.fields, rejected: cached.rejected } : null };
  },
});

export const saveExtraction = internalMutation({
  args: { taskId: v.id("agentTasks"), token: v.string(), documentId: v.id("documents"), kind: v.string(), fields: v.any(), rejected: v.array(v.string()), model: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await taskFor(ctx, args.taskId, args.token);
    const existing = await ctx.db.query("extractions").withIndex("by_document", q => q.eq("ns", task.ns).eq("documentId", args.documentId)).first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("extractions", { ns: task.ns, origin: "AGENT", documentId: args.documentId, kind: args.kind as never, fields: args.fields, rejected: args.rejected, model: args.model, extractedAt: await getSimNow(ctx, task.ns) });
    await attachEvidence(ctx, task, [{ kind: "DOC", documentId: (await ctx.db.get(args.documentId))!.code }]);
    return null;
  },
});

async function aisPoints(ctx: QueryCtx, task: Doc<"agentTasks">, bundle: CaseBundle): Promise<AisPoint[]> {
  return (await aisWindow(ctx, await scopeFor(ctx, task, bundle), { vesselId: bundle.vessel._id, from: bundle.voyage.eta - 5 * DAY, to: Number.MAX_SAFE_INTEGER })).points;
}

/** AIS summary: arrival in port limits, movements after arrival (shifting), dark gaps, last position. Never raw tracks. */
export const getAis = internalQuery({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const points = await aisPoints(ctx, task, bundle);
    const arrivalAt = detectGeofenceEntry(points, bundle.port.anchorage);
    const movements = arrivalAt ? detectMovementIntervals(points.filter(point => point.at >= arrivalAt)) : [];
    const last = points[points.length - 1];
    const positions = Array.isArray(input.at) ? (input.at as number[]).slice(0, 4).map(at => { const position = positionAt(points, at); return position && { at, lon: Number(position.lon.toFixed(4)), lat: Number(position.lat.toFixed(4)), inPortLimits: pointInPolygon([position.lon, position.lat], bundle.port.anchorage), distanceToPortLimitsNm: distanceToPolygonNm([position.lon, position.lat], bundle.port.anchorage) }; }) : [];
    return {
      points: points.length, arrivalInPortLimitsAt: arrivalAt,
      movementsAfterArrival: movements.map(movement => ({ ...movement, endsAtBerth: Boolean(points.find(point => point.at === movement.endAt && pointInPolygon([point.lon, point.lat], bundle.port.berth))) })),
      darkGaps: detectAisGaps(points), last: last ? { at: last.at, sogKn: last.sogKn, inPortLimits: pointInPolygon([last.lon, last.lat], bundle.port.anchorage), atBerth: pointInPolygon([last.lon, last.lat], bundle.port.berth) } : null,
      positions,
    };
  },
});

export const convertLocalTimes = internalQuery({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const year = new Date(bundle.voyage.eta).getUTCFullYear();
    return ((input.rows as { localText: string; fold?: 0 | 1 }[]) ?? []).slice(0, 40).map(row => {
      try { return { localText: row.localText, utc: localToUtc(sofTextToIso(row.localText, year), bundle.port.ianaZone, { fold: row.fold }) }; }
      catch (error) { return { localText: row.localText, error: (error as Error).message }; }
    });
  },
});

export const searchCustomsPortalTool = internalQuery({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    return searchCustomsPortal(ctx, await scopeFor(ctx, task, bundle), { portId: bundle.port._id, vesselId: bundle.vessel._id, from: Number(input.from), to: Number(input.to) });
  },
});

export const contractTermsTool = internalQuery({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const contract = input.side === "RECOVERABLE" ? bundle.cargo : bundle.charter;
    return { code: contract.code, formCode: contract.formCode, kind: contract.kind, terms: contract.terms, source: "CONTRACT_REGISTER" };
  },
});

export const searchMemory = internalQuery({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token }) => {
    const task = await taskFor(ctx, taskId, token);
    const items = await ctx.db.query("memoryItems").withIndex("by_ns", q => q.eq("ns", task.ns)).collect();
    return items.filter(item => item.status === "ACTIVE" || item.status === "PRECEDENT_ONLY").map(item => ({ code: item.code, kind: item.kind, status: item.status, title: item.title, scope: item.scope, executable: item.status === "ACTIVE" }));
  },
});

export const listOpenCases = internalQuery({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token }) => {
    const task = await taskFor(ctx, taskId, token);
    const cases = await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", task.ns)).collect();
    const rows = [];
    for (const item of cases.filter(candidate => candidate.status !== "CLOSED" && candidate.origin !== "HISTORY_IMPORT")) {
      const facts = await currentFacts(ctx, task.ns, item._id);
      rows.push({ caseCode: item.code, hasLaytimeStart: Boolean(factValue(facts, "LAYTIME_START_PAYABLE")), accruedCents: await accruedCents(ctx, task.ns, item._id), apPosted: await apPosted(ctx, task.ns, item._id) });
    }
    return rows;
  },
});

// ---------------------------------------------------------------- facts from evidence
/**
 * NOR → laytime starts (both contracts). Runs when the NOR is checked and again when AIS shows arrival: a NOR tendered
 * outside port limits is deemed tendered on arrival (cl. 5(c)), which only AIS can establish. The money the owner's
 * reading would add (tender + notice vs. our start) is attached to the visible step when the start becomes known.
 */
async function establishLaytime(ctx: MutationCtx, task: Doc<"agentTasks">, bundle: CaseBundle, simNow: number) {
  const caseId = bundle.case._id;
  const facts = await currentFacts(ctx, task.ns, caseId);
  const tender = factValue<{ at: number; documentCode: string; position: [number, number]; quote?: string }>(facts, "NOR_TENDERED");
  if (!tender) return null;
  const points = await aisPoints(ctx, task, bundle);
  const arrivalAt = detectGeofenceEntry(points, bundle.port.anchorage);
  const evaluate = (terms: ContractTerms) => evaluateNor({ tenderedAt: tender.at, arrivalAt, positionAtTender: tender.position, portLimits: bundle.port.anchorage, terms });
  const payable = evaluate(bundle.charter.terms), recoverable = evaluate(bundle.cargo.terms);
  const evidence: EvidenceRef[] = [{ kind: "DOC", documentId: tender.documentCode, ...(tender.quote ? { quote: tender.quote } : {}) }, { kind: "AIS", vesselId: bundle.vessel.code, from: tender.at, to: arrivalAt ?? simNow }];
  const known = factValue<{ at: number }>(facts, "LAYTIME_START_PAYABLE");
  if (payable.laytimeStartAt !== null && known?.at !== payable.laytimeStartAt) {
    if (arrivalAt !== null && !factValue(facts, "ARRIVAL_IN_PORT_LIMITS")) await writeFact(ctx, task, caseId, "ARRIVAL_IN_PORT_LIMITS", { at: arrivalAt }, [evidence[1]], simNow);
    await writeFact(ctx, task, caseId, "NOR_VALIDITY", { valid: payable.valid, reason: payable.reason, effectiveAt: payable.effectiveAt, distanceNm: payable.distanceNm }, evidence, simNow);
    await writeFact(ctx, task, caseId, "LAYTIME_START_PAYABLE", { at: payable.laytimeStartAt }, evidence, simNow);
    if (recoverable.laytimeStartAt !== null) await writeFact(ctx, task, caseId, "LAYTIME_START_RECOVERABLE", { at: recoverable.laytimeStartAt }, evidence, simNow);
    const ownerStart = tender.at + bundle.charter.terms.noticeMinutes * 60_000;
    await attachDelta(ctx, task, -proRataCents(Math.max(0, (payable.laytimeStartAt - ownerStart) / 60_000), bundle.charter.terms.ratePerHourCents));
    await attachEvidence(ctx, task, evidence);
  }
  return { payable, recoverable, arrivalAt, tenderedAt: tender.at };
}

export const checkNor = internalMutation({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const document = await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", task.ns).eq("code", String(input.documentCode))).unique();
    if (!document || document.kind !== "NOR") fail("MISSING_EVIDENCE", "Not a NOR document");
    const extraction = await ctx.db.query("extractions").withIndex("by_document", q => q.eq("ns", task.ns).eq("documentId", document._id)).first();
    const quote = (extraction?.fields as { tenderedAt?: { quote: string } } | undefined)?.tenderedAt?.quote;
    const tenderedAt = quote ? parseUtcDateTime(quote) : null;
    if (tenderedAt === null) fail("QUOTE_NOT_FOUND", "Read the NOR first; tender time not verified");
    const position = positionAt(await aisPoints(ctx, task, bundle), tenderedAt);
    if (!position) fail("MISSING_EVIDENCE", "No AIS position at the tender time");
    const simNow = await getSimNow(ctx, task.ns);
    const at: [number, number] = [Number(position.lon.toFixed(4)), Number(position.lat.toFixed(4))];
    const evidence: EvidenceRef[] = [{ kind: "DOC", documentId: document.code, quote }, { kind: "AIS", vesselId: bundle.vessel.code, from: tenderedAt, to: simNow }];
    await writeFact(ctx, task, bundle.case._id, "NOR_TENDERED", { at: tenderedAt, documentCode: document.code, position: at, quote }, evidence, simNow);
    const tender = evaluateNor({ tenderedAt, arrivalAt: null, positionAtTender: at, portLimits: bundle.port.anchorage, terms: bundle.charter.terms });
    await writeFact(ctx, task, bundle.case._id, "NOR_VALIDITY", { valid: tender.valid, reason: tender.reason, effectiveAt: tender.effectiveAt, distanceNm: tender.distanceNm }, evidence, simNow);
    await attachEvidence(ctx, task, evidence);
    const established = await establishLaytime(ctx, task, bundle, simNow);
    const payable = established?.payable ?? tender;
    return {
      valid: payable.valid, reason: payable.reason, tenderedAt, distanceOutsidePortLimitsNm: Number(tender.distanceNm.toFixed(1)),
      arrivalInPortLimitsAt: established?.arrivalAt ?? null, laytimeStartPayable: payable.laytimeStartAt, laytimeStartRecoverable: established?.recoverable.laytimeStartAt ?? null,
      ...(payable.laytimeStartAt === null ? { note: "Not yet in port limits: the NOR is deemed tendered on arrival, which AIS will show" } : {}),
    };
  },
});

/** A re-recorded interval replaces the current one of the same kind that it overlaps (e.g. SOF confirming an AIS move). */
const sameInterval = (kind: string, startAt: number, endAt: number) => (fact: Doc<"facts">) => {
  const value = fact.value as { kind?: string; startAt?: number; endAt?: number };
  return value.kind === kind && (value.startAt ?? 0) < endAt && (value.endAt ?? 0) > startAt;
};

type IntervalFactForClosure = { kind: string; verified: boolean };
type SofRow = { localText: string; fold?: 0 | 1; entry: string };
/** Intervals from verified SOF rows (times computed here from the quoted local times) and from AIS; facts are superseded on re-record. */
export const recordIntervals = internalMutation({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const caseId = bundle.case._id, ns = task.ns;
    const simNow = await getSimNow(ctx, ns);
    const year = new Date(bundle.voyage.eta).getUTCFullYear();
    const recorded: Record<string, unknown>[] = [];
    let rows: SofRow[] = [];
    let sofCode: string | undefined;
    let sofExtraction: Doc<"extractions"> | null = null;
    const mapped = new Set<number>();
    if (input.sofDocumentCode) {
      const document = await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", ns).eq("code", String(input.sofDocumentCode))).unique();
      const extraction = document && await ctx.db.query("extractions").withIndex("by_document", q => q.eq("ns", ns).eq("documentId", document._id)).first();
      if (!document || !extraction) fail("QUOTE_NOT_FOUND", "Read the SOF first");
      rows = ((extraction.fields as { rows?: SofRow[] }).rows ?? []);
      sofCode = document.code;
      sofExtraction = extraction;
      for (const index of (extraction.fields as { mappedRows?: number[] }).mappedRows ?? []) mapped.add(index);
    }
    const rowAt = (index: unknown) => {
      const row = rows[Number(index)];
      if (!row) fail("MISSING_EVIDENCE", `SOF row ${String(index)} not found`);
      mapped.add(Number(index));
      return localToUtc(sofTextToIso(row.localText, year), bundle.port.ianaZone, { fold: row.fold });
    };
    const docEvidence = (indexes: unknown[]): EvidenceRef[] => sofCode ? indexes.map(index => ({ kind: "DOC" as const, documentId: sofCode!, quote: rows[Number(index)]?.localText })) : [];
    if (input.noticeDocumentCode) {
      const { document } = await getDocument(ctx, await scopeFor(ctx, task, bundle), String(input.noticeDocumentCode));
      const extraction = await ctx.db.query("extractions").withIndex("by_document", q => q.eq("ns", ns).eq("documentId", document._id)).first();
      if (document.kind !== "PORT_CLOSURE" || !extraction || extraction.rejected.length) fail("QUOTE_NOT_FOUND", "Read and verify the closure notice first");
      const fields = extraction.fields as { start?: { quote: string }; end?: { quote: string } };
      const startAt = parseUtcDateTime(fields.start?.quote ?? ""), endAt = parseUtcDateTime(fields.end?.quote ?? "");
      if (startAt === null || endAt === null || endAt <= startAt) fail("QUOTE_NOT_FOUND", "The closure notice must state a valid interval");
      const evidence: EvidenceRef[] = [{ kind: "DOC", documentId: document.code, quote: fields.start!.quote }, { kind: "DOC", documentId: document.code, quote: fields.end!.quote }];
      await writeFact(ctx, task, caseId, "INTERVAL", { kind: "PORT_CLOSURE", startAt, endAt, verified: true, source: "NOTICE" }, evidence, simNow, sameInterval("PORT_CLOSURE", startAt, endAt));
      await attachEvidence(ctx, task, evidence);
      recorded.push({ kind: "PORT_CLOSURE", startAt, endAt, verified: true, source: "NOTICE" });
    }
    const points = await aisPoints(ctx, task, bundle);
    if (input.arrivalFromAis) {
      const arrivalAt = detectGeofenceEntry(points, bundle.port.anchorage);
      if (arrivalAt && factValue<{ at: number }>(await currentFacts(ctx, ns, caseId), "ARRIVAL_IN_PORT_LIMITS")?.at !== arrivalAt) {
        await writeFact(ctx, task, caseId, "ARRIVAL_IN_PORT_LIMITS", { at: arrivalAt }, [{ kind: "AIS", vesselId: bundle.vessel.code, from: arrivalAt, to: arrivalAt }], simNow);
        recorded.push({ arrivalAt });
      }
      const laytime = arrivalAt ? await establishLaytime(ctx, task, bundle, simNow) : null;
      if (laytime?.payable.laytimeStartAt) recorded.push({ norDeemedAt: laytime.payable.effectiveAt, laytimeStartPayable: laytime.payable.laytimeStartAt, laytimeStartRecoverable: laytime.recoverable.laytimeStartAt });
    }
    if (input.shiftingFromAis) {
      const arrivalAt = detectGeofenceEntry(points, bundle.port.anchorage);
      for (const movement of arrivalAt ? detectMovementIntervals(points.filter(point => point.at >= arrivalAt)) : []) {
        await writeFact(ctx, task, caseId, "INTERVAL", { kind: "SHIFTING", startAt: movement.startAt, endAt: movement.endAt, verified: true, source: "AIS" }, [{ kind: "AIS", vesselId: bundle.vessel.code, from: movement.startAt, to: movement.endAt }], simNow,
          sameInterval("SHIFTING", movement.startAt, movement.endAt));
        recorded.push({ kind: "SHIFTING", ...movement, verified: true, source: "AIS" });
      }
    }
    for (const spec of (input.intervals as { kind: string; fromRow: number; toRow: number }[] | undefined) ?? []) {
      const startAt = rowAt(spec.fromRow), endAt = rowAt(spec.toRow);
      if (!(endAt > startAt)) fail("MISSING_EVIDENCE", `Interval ${spec.kind} rows ${spec.fromRow}→${spec.toRow} has no duration`);
      let verified = false, source = "SOF";
      if (spec.kind === "PORT_CLOSURE") {
        // Verified when an official closure notice received for this port states a window that overlaps the SOF interval.
        const notices = await ctx.db.query("documents").withIndex("by_ns", q => q.eq("ns", ns)).filter(q => q.and(q.eq(q.field("kind"), "PORT_CLOSURE"), q.eq(q.field("portId"), bundle.port._id))).collect();
        verified = notices.some(notice => {
          const [from, until] = parseUtcDateTimes(notice.textLayer ?? "");
          return notice.receivedAt !== undefined && notice.receivedAt <= simNow && from !== undefined && until !== undefined && from < endAt && until > startAt;
        });
        source = verified ? "SOF+NOTICE" : "SOF";
      } else if (spec.kind === "SHIFTING") {
        verified = detectMovementIntervals(points).some(movement => movement.startAt < endAt && movement.endAt > startAt);
        source = verified ? "SOF+AIS" : "SOF";
      } else if (spec.kind === "WEATHER") { verified = true; }
      // CUSTOMS_HOLD stays unverified until a release covering it is linked (verifyHold) or a human confirms it.
      await writeFact(ctx, task, caseId, "INTERVAL", { kind: spec.kind, startAt, endAt, verified, source }, docEvidence([spec.fromRow, spec.toRow]), simNow,
        sameInterval(spec.kind, startAt, endAt));
      recorded.push({ kind: spec.kind, startAt, endAt, verified, source });
    }
    if (input.completionRow !== undefined && input.completionRow !== null) {
      const at = rowAt(input.completionRow);
      await writeFact(ctx, task, caseId, "COMPLETION", { at }, docEvidence([input.completionRow]), simNow);
      recorded.push({ completionAt: at });
    }
    for (const index of (input.noteRows as number[] | undefined) ?? []) if (rows[index]) mapped.add(index);
    if (sofExtraction) await ctx.db.patch(sofExtraction._id, { fields: { ...(sofExtraction.fields as object), mappedRows: [...mapped].sort((a, b) => a - b) } });
    if (sofCode) await attachEvidence(ctx, task, [{ kind: "DOC", documentId: sofCode }]);
    return { sofRows: rows.length, rowsMapped: mapped.size, unmappedRows: rows.map((row, index) => ({ index, ...row })).filter(row => !mapped.has(row.index)), recorded, intervals: intervalFacts(await currentFacts(ctx, ns, caseId)).map(({ factId, ...rest }) => { void factId; return rest; }) };
  },
});

/** Marks a customs hold verified by a release from the customs portal that covers it (needs the portal capability). */
export const verifyHold = internalMutation({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const scope = await scopeFor(ctx, task, bundle);
    const { document, capabilityId } = await getDocument(ctx, scope, String(input.documentCode));
    if (document.kind !== "CUSTOMS_RELEASE") fail("MISSING_EVIDENCE", "Not a customs release");
    const record = await ctx.db.query("customsRecords").withIndex("by_port_vessel", q => q.eq("ns", task.ns).eq("portId", bundle.port._id).eq("vesselId", bundle.vessel._id)).filter(q => q.eq(q.field("documentId"), document._id)).first();
    const holds = intervalFacts(await currentFacts(ctx, task.ns, bundle.case._id)).filter(interval => interval.kind === "CUSTOMS_HOLD" && !interval.verified);
    const hold = holds.find(candidate => record && record.kind === "RELEASE" && record.startAt <= candidate.startAt && (record.endAt ?? 0) >= candidate.endAt);
    if (!hold) return { verified: false, reason: "The release does not cover an open customs hold" };
    const simNow = await getSimNow(ctx, task.ns);

    await writeFact(ctx, task, bundle.case._id, "INTERVAL", { ...hold, factId: undefined, verified: true, source: "PORTAL", documentCode: document.code }, [{ kind: "DOC", documentId: document.code }], simNow, fact => fact._id === hold.factId);
    await attachEvidence(ctx, task, [{ kind: "DOC", documentId: document.code }]);
    return { verified: true, startAt: hold.startAt, endAt: hold.endAt, documentCode: document.code, capabilityId };
  },
});

// ---------------------------------------------------------------- money
async function computeAndStore(ctx: MutationCtx, task: Doc<"agentTasks">, bundle: CaseBundle, side: "PAYABLE" | "RECOVERABLE") {
  const ns = task.ns, caseId = bundle.case._id;
  const facts = await currentFacts(ctx, ns, caseId);
  const start = factValue<{ at: number }>(facts, side === "PAYABLE" ? "LAYTIME_START_PAYABLE" : "LAYTIME_START_RECOVERABLE");
  const completion = factValue<{ at: number }>(facts, "COMPLETION");
  if (!start || !completion) fail("MISSING_EVIDENCE", "Laytime start and completion must be established first");
  const contract = side === "PAYABLE" ? bundle.charter : bundle.cargo;
  const intervals: IntervalInput[] = intervalFacts(facts).map(interval => ({ kind: interval.kind as IntervalInput["kind"], startAt: interval.startAt, endAt: interval.endAt, verified: interval.verified, evidence: facts.find(fact => fact._id === interval.factId)?.evidence ?? [] }));
  const previous = await latestStatement(ctx, ns, caseId, side);
  const edits = previous ? await ctx.db.query("statementEdits").withIndex("by_statement", q => q.eq("ns", ns).eq("statementId", previous._id)).filter(q => q.eq(q.field("status"), "APPLIED")).collect() : [];
  const reconciliation = bundle.case.reconciliation as { acceptedFees?: { label: string; cents: number }[]; invoiceCode?: string } | undefined;
  const fees = side === "PAYABLE" ? (reconciliation?.acceptedFees ?? []).map(fee => ({ label: fee.label, cents: fee.cents, evidence: reconciliation?.invoiceCode ? [{ kind: "DOC" as const, documentId: reconciliation.invoiceCode }] : [] })) : [];
  const result = computeStatement({
    side, terms: contract.terms, formCode: contract.formCode, contractId: contract.code, laytimeStartAt: start.at, completionAt: completion.at, intervals, fees,
    overrides: side === "PAYABLE" ? await activeOverrides(ctx, ns, contract.formCode) : [],
    edits: edits.map(edit => ({ editId: String(edit._id), lineId: edit.lineId, treatment: edit.to as never })),
  });
  const version = (previous?.version ?? 0) + 1;
  const statementId = await ctx.db.insert("statements", { ns, origin: "AGENT", caseId, side, version, contractId: contract._id, laytimeStartAt: start.at, completionAt: completion.at, lines: result.lines, totals: result.totals, computedAt: await getSimNow(ctx, ns), memoryItemIds: result.memoryItemIds });
  // Carry applied edits forward so a recompute never silently drops a human decision.
  for (const edit of edits) await ctx.db.insert("statementEdits", { ns, origin: edit.origin, statementId, lineId: edit.lineId, field: edit.field, from: edit.from, to: edit.to, basis: edit.basis, at: edit.at, status: "APPLIED", ...(edit.personaId ? { personaId: edit.personaId } : {}) });
  const summary = { statementId: String(statementId), totalCents: result.totals.totalCents, version };
  await ctx.db.patch(caseId, side === "PAYABLE" ? { payable: summary, updatedAt: Date.now() } : { recoverable: summary, updatedAt: Date.now() });
  for (const code of result.memoryItemIds) {
    const item = await ctx.db.query("memoryItems").withIndex("by_code", q => q.eq("ns", ns).eq("code", code)).unique();
    if (item && !item.usedIn.includes(caseId)) await ctx.db.patch(item._id, { usedIn: [...item.usedIn, caseId] });
  }
  if (result.memoryItemIds.length) {
    const step = await currentStep(ctx, task);
    if (step) await ctx.db.patch(step._id, { memoryRefs: [...new Set([...step.memoryRefs, ...result.memoryItemIds])] });
  }
  return { result, previous, version };
}

export const computeStatementTool = internalMutation({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const side = input.side === "RECOVERABLE" ? "RECOVERABLE" : "PAYABLE";
    const { result, previous, version } = await computeAndStore(ctx, task, bundle, side);
    if (side === "PAYABLE" && previous) await attachDelta(ctx, task, result.totals.totalCents - previous.totals.totalCents);
    return { side, version, totals: result.totals, memoryItemIds: result.memoryItemIds, lines: result.lines.map(line => ({ id: line.id, kind: line.kind, minutes: line.minutes, treatment: line.treatment, countedMinutes: line.countedMinutes, note: line.note })) };
  },
});

type Field = { value: string; quote: string };
type InvoiceFields = { invoiceNo: Field; laytimeStart: Field; completion: Field; timeUsed: Field; demurrageTime?: Field; demurrageAmount?: Field; total: Field; fees?: { label: Field; amount: Field }[] };

export const reconcileInvoiceTool = internalMutation({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const document = await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", task.ns).eq("code", String(input.documentCode))).unique();
    const extraction = document && await ctx.db.query("extractions").withIndex("by_document", q => q.eq("ns", task.ns).eq("documentId", document._id)).first();
    if (!document || document.kind !== "OWNER_INVOICE" || !extraction) fail("QUOTE_NOT_FOUND", "Read the owner invoice first");
    const fields = extraction.fields as InvoiceFields;
    const total = parseMoney(fields.total.quote), demurrage = parseMoney(fields.demurrageAmount?.quote ?? "");
    const invoice: ExtractedInvoice = {
      invoiceNo: fields.invoiceNo.value, currency: total?.currency ?? "USD",
      laytimeStartAt: parseUtcDateTime(fields.laytimeStart.quote) ?? NaN, completionAt: parseUtcDateTime(fields.completion.quote) ?? NaN,
      timeUsedMinutes: parseHoursToMinutes(fields.timeUsed.quote) ?? NaN, demurrageMinutes: parseHoursToMinutes(fields.demurrageTime?.quote ?? "") ?? 0,
      demurrageCents: demurrage?.cents ?? 0, totalCents: total?.cents ?? NaN,
      fees: (fields.fees ?? []).map(fee => ({ label: fee.label.value, cents: parseMoney(fee.amount.quote)?.cents ?? NaN })),
    };
    if ([invoice.laytimeStartAt, invoice.completionAt, invoice.timeUsedMinutes, invoice.totalCents].some(Number.isNaN) || invoice.fees.some(fee => Number.isNaN(fee.cents))) fail("QUOTE_NOT_FOUND", "Invoice values could not be read from verified quotes");
    // Duplicate: same vessel, same total, a different invoice number already reconciled for this case.
    const prior = bundle.case.reconciliation as { invoiceNo?: string; totalCents?: number } | undefined;
    if (prior?.invoiceNo && prior.invoiceNo !== invoice.invoiceNo && prior.totalCents === invoice.totalCents) {
      return { duplicateOf: prior.invoiceNo, action: "Rejected as a duplicate; nothing posted" };
    }
    const statement = await latestStatement(ctx, task.ns, bundle.case._id, "PAYABLE");
    if (!statement) fail("MISSING_EVIDENCE", "Compute the payable statement first");
    const policies = await loadPolicies(ctx, task.ns);
    const materiality = (policies.MATERIALITY?.thresholdCents as number) ?? 25_000;
    const noFees = { ...statement.totals, totalCents: statement.totals.demurrageCents, feesCents: 0 };
    const result = reconcileInvoice(statement.lines.filter(line => line.kind !== "FEE"), noFees, invoice, materiality, bundle.charter.terms.ratePerHourCents);
    const reconciliation = {
      invoiceCode: document.code, invoiceNo: invoice.invoiceNo, currency: invoice.currency, totalCents: invoice.totalCents,
      payableCents: result.payableCents, disputeCents: result.disputeCents, variances: result.variances,
      acceptedFees: result.acceptedBelowMateriality.map(variance => ({ label: variance.owner, cents: variance.cents })),
      statementVersion: statement.version,
    };
    await ctx.db.patch(bundle.case._id, { reconciliation, billedCents: invoice.totalCents, disputedCents: result.disputeCents, invoiceDocumentId: document._id, updatedAt: Date.now() });
    await attachEvidence(ctx, task, [{ kind: "DOC", documentId: document.code }]);
    return reconciliation;
  },
});

export const postAccrual = internalMutation({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const ns = task.ns, caseId = bundle.case._id;
    const simNow = await getSimNow(ctx, ns);
    const period = await periodAt(ctx, ns, simNow);
    if (!period) fail("PERIOD_LOCKED", "No open period");
    const facts = await currentFacts(ctx, ns, caseId);
    const start = factValue<{ at: number }>(facts, "LAYTIME_START_PAYABLE");
    if (!start) return { caseCode: bundle.case.code, action: "No laytime yet; nothing to accrue" };
    const completion = factValue<{ at: number }>(facts, "COMPLETION");
    const until = Math.min(completion?.at ?? period.endAt, period.endAt);
    const intervals: IntervalInput[] = intervalFacts(facts).filter(interval => interval.startAt < until).map(interval => ({ kind: interval.kind as IntervalInput["kind"], startAt: interval.startAt, endAt: Math.min(interval.endAt, until), verified: interval.verified, evidence: [] }));
    const estimate = until > start.at ? computeStatement({ side: "PAYABLE", terms: bundle.charter.terms, formCode: bundle.charter.formCode, contractId: bundle.charter.code, laytimeStartAt: start.at, completionAt: until, intervals, fees: [], overrides: await activeOverrides(ctx, ns, bundle.charter.formCode), edits: [] }).totals.demurrageCents : 0;
    const already = await accruedCents(ctx, ns, caseId);
    const draft = buildAccrual(bundle.case.code, estimate, already);
    if (!draft) {
      await appendAudit(ctx, { ns, origin: "AGENT", actor: `agent:${task._id}`, role: "agent", type: "ACCRUAL_UNCHANGED", entityType: "accrual", entityId: `accrual:${bundle.case.code}:${period.code}`, correlationId: bundle.case.correlationId, details: { estimateCents: estimate, accruedCents: already }, at: simNow });
      return { caseCode: bundle.case.code, estimateCents: estimate, accruedCents: already, action: "No change" };
    }
    await postJournalTx(ctx, { ns, draft, caseId, postedAt: simNow, idempotencyKey: `accrual:${bundle.case.code}:${period.code}`, authority: { kind: "DELEGATION", policyCode: "ACCRUAL" }, evidence: [{ kind: "AIS", vesselId: bundle.vessel.code, from: start.at, to: until }], ...actorOf(task, bundle) });
    if (task.caseId === caseId) await attachDelta(ctx, task, 0);
    return { caseCode: bundle.case.code, estimateCents: estimate, accruedBeforeCents: already, postedCents: estimate - already, period: period.code, kind: draft.kind };
  },
});

const OPTIONS: Record<string, { id: string; label: string; requires?: ("AMOUNT" | "REASON" | "EVIDENCE" | "EDITS")[] }[]> = {
  FACT: [{ id: "CONFIRM", label: "Confirm", requires: ["EVIDENCE"] }, { id: "DIFFERENT", label: "Different cause", requires: ["REASON", "EVIDENCE"] }, { id: "CANT_FIND", label: "Can't find" }],
  PAYMENT: [{ id: "APPROVE", label: "Approve", requires: [] }, { id: "REJECT", label: "Reject", requires: ["REASON"] }],
  RECOVERY_FILING: [{ id: "PURSUE", label: "Pursue" }, { id: "PARTIAL", label: "Partial", requires: ["AMOUNT", "REASON"] }, { id: "WAIVE", label: "Waive", requires: ["REASON"] }],
};

async function delegationContext(ctx: QueryCtx, task: Doc<"agentTasks">, bundle: CaseBundle) {
  const policies = await loadPolicies(ctx, task.ns);
  const reconciliation = bundle.case.reconciliation as { disputeCents?: number; currency?: string } | undefined;
  return { counterpartyStrategic: bundle.cargoParty.strategic, openDisputeAboveMateriality: Boolean(reconciliation?.disputeCents && !belowMateriality(reconciliation.disputeCents, policies)), currencyMismatch: Boolean(reconciliation?.currency && reconciliation.currency !== "USD"), statementComplete: true };
}

const MONEY_TEXT = /(?:USD|EUR|\$|€)\s?-?\d|\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|dollars)/i;
const shortDate = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const shortName = (name: string) => name.split(/\s+/).slice(0, 2).join(" ");

/** Recovery at stake on an unverified interval: the recoverable statement recomputed as if it were verified (engine, not model). */
async function factAtStake(ctx: QueryCtx, task: Doc<"agentTasks">, bundle: CaseBundle) {
  const facts = await currentFacts(ctx, task.ns, bundle.case._id);
  const completion = factValue<{ at: number }>(facts, "COMPLETION");
  let cents = 0;
  for (const side of ["RECOVERABLE"] as const) {
    const start = factValue<{ at: number }>(facts, "LAYTIME_START_RECOVERABLE");
    if (!start || !completion) continue;
    const contract = bundle.cargo;
    const run = (verifyAll: boolean) => computeStatement({ side, terms: contract.terms, formCode: contract.formCode, contractId: contract.code, laytimeStartAt: start.at, completionAt: completion.at, fees: [], edits: [], overrides: [],
      intervals: intervalFacts(facts).map(interval => ({ kind: interval.kind as IntervalInput["kind"], startAt: interval.startAt, endAt: interval.endAt, verified: verifyAll || interval.verified, evidence: [] })) }).totals.totalCents;
    cents += Math.abs(run(true) - run(false));
  }
  return cents;
}

export const createAskTool = internalMutation({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const need = String(input.need) as Need;
    if (!["FACT", "PAYMENT", "RECOVERY_FILING"].includes(need)) fail("NOT_PERMITTED", "The agent can ask for a fact, a payment approval or a recovery decision");
    const simNow = await getSimNow(ctx, task.ns);
    const facts = await currentFacts(ctx, task.ns, bundle.case._id);
    const completion = factValue<{ at: number }>(facts, "COMPLETION");
    const timeBarAt = completion && bundle.cargo.terms.timeBar ? completion.at + bundle.cargo.terms.timeBar.days * DAY : undefined;
    const recovery = await latestStatement(ctx, task.ns, bundle.case._id, "RECOVERABLE");
    const reconciliation = bundle.case.reconciliation as { payableCents?: number; disputeCents?: number } | undefined;
    const policies = await loadPolicies(ctx, task.ns);
    const apLimit = (policies.AP_POSTING?.maxCents as number | undefined) ?? 5_000_000;
    let question: string, amount: number;
    if (need === "PAYMENT") {
      if (!reconciliation?.payableCents) fail("MISSING_EVIDENCE", "Reconcile the invoice first");
      amount = reconciliation.payableCents;
      const dispute = reconciliation.disputeCents ? `, dispute ${formatUsd(reconciliation.disputeCents)}` : "";
      question = `Approve ${formatUsd(amount)} to ${shortName(bundle.owner.name)}${dispute}?${amount > apLimit ? ` Over ${formatUsd(apLimit)} limit.` : ""}`;
    } else if (need === "RECOVERY_FILING") {
      if (!recovery) fail("MISSING_EVIDENCE", "Compute the recoverable statement first");
      amount = recovery.totals.totalCents;
      question = `File ${formatUsd(amount)} demurrage claim on ${shortName(bundle.cargoParty.name)}?${timeBarAt ? ` Time bar ${shortDate(timeBarAt)}.` : ""}`;
    } else {
      // The fact question is the model's words; amounts are not (REQ-AGT-03). The engine appends what is at stake.
      const interval = intervalFacts(facts).find(interval => interval.kind === input.subject && !interval.verified);
      const clockTime = (at: number) => `${shortDate(at)} ${String(new Date(at).getUTCHours()).padStart(2, "0")}:${String(new Date(at).getUTCMinutes()).padStart(2, "0")}`;
      const text = interval
        ? `Confirm ${interval.kind.toLowerCase().replaceAll("_", " ")} ${clockTime(interval.startAt)}–${clockTime(interval.endAt)}?`
        : String(input.question ?? "").trim().replace(/\s+/g, " ");
      if (!text) fail("NOT_PERMITTED", "A question is required");
      if (MONEY_TEXT.test(text)) fail("NOT_PERMITTED", "Do not state amounts in the question; the engine adds what is at stake");
      amount = await factAtStake(ctx, task, bundle);
      const stake = amount > 0 ? ` ${formatUsd(amount)} of ${shortName(bundle.cargoParty.name)} recovery depends on it.` : "";
      question = `${text.replace(/[.?]?$/, (end) => end || ".")}${stake}`;
    }
    const evidence: EvidenceRef[] = ((input.evidenceDocs as string[] | undefined) ?? []).map(code => ({ kind: "DOC" as const, documentId: code }));
    const askId = await createAskTx(ctx, {
      ns: task.ns, caseId: bundle.case._id, need, question, subject: String(input.subject ?? need),
      options: OPTIONS[need], context: { evidence, ...(Array.isArray(input.contextLineIds) ? { lineIds: (input.contextLineIds as string[]).slice(0, 8) } : {}) },
      amountAtRiskCents: amount, delegation: await delegationContext(ctx, task, bundle), createdAt: simNow,
      ...(need === "RECOVERY_FILING" && timeBarAt ? { deadlineAt: timeBarAt } : {}),
      ...actorOf(task, bundle),
    });
    const ask = (await ctx.db.get(askId))!;
    const step = await currentStep(ctx, task);
    if (step) await ctx.db.patch(step._id, { status: "ASKED" });
    return { askCode: ask.code, role: ask.role, kind: ask.kind, question: ask.question, gatesClock: ask.gatesClock };
  },
});

export const fileRecovery = internalMutation({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const ns = task.ns, caseId = bundle.case._id;
    const statement = await latestStatement(ctx, ns, caseId, "RECOVERABLE");
    if (!statement) fail("MISSING_EVIDENCE", "Compute the recoverable statement first");
    if (intervalFacts(await currentFacts(ctx, ns, caseId)).some(interval => interval.kind === "CUSTOMS_HOLD" && !interval.verified) && (await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect()).some(ask => ask.status === "OPEN" && ask.kind === "CONFIRM_FACT")) {
      return { filed: false, reason: "A customs hold is still being verified; file after the answer" };
    }
    const simNow = await getSimNow(ctx, ns);
    const policies = await loadPolicies(ctx, ns);
    const route = routeAsk({ need: "RECOVERY_FILING", amountCents: statement.totals.totalCents, ctx: { counterpartyStrategic: bundle.cargoParty.strategic }, policies });
    let cents = statement.totals.totalCents;
    let authority: Doc<"filings">["authority"] = { kind: "DELEGATION", policyCode: "RECOVERY_FILING" };
    let kind: "RECOVERY_CLAIM" | "PROTECTIVE_NOTICE" = "RECOVERY_CLAIM";
    if (input.protective) {
      const completion = factValue<{ at: number }>(await currentFacts(ctx, ns, caseId), "COMPLETION");
      const timeBarAt = completion && bundle.cargo.terms.timeBar ? completion.at + bundle.cargo.terms.timeBar.days * DAY : null;
      const asks = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
      if (timeBarAt === null || !asks.some(ask => deadlineFallbackDue(ask, simNow, timeBarAt, policies))) fail("NOT_PERMITTED", "Protective filing requires an unanswered recovery decision within the deadline window");
      authority = { kind: "DELEGATION", policyCode: "DEADLINE_FALLBACK" }; kind = "PROTECTIVE_NOTICE";
    } else if (route.required) {
      const asks = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
      const decision = asks.filter(ask => ask.kind === "COMMERCIAL_DECISION" && ask.status === "ANSWERED").pop();
      if (!decision) return { filed: false, needsAsk: { need: "RECOVERY_FILING", role: route.role, amountCents: cents } };
      const answer = decision.answer!;
      if (answer.optionId === "WAIVE") return { filed: false, waived: true, reason: answer.reason };
      if (answer.optionId === "PARTIAL") cents = answer.amountCents ?? cents;
      authority = { kind: "APPROVAL", askId: String(decision._id), personaId: String(decision.answeredBy) };
    }
    if (cents <= 0) return { filed: false, reason: "Nothing recoverable" };
    await fileRecoveryTx(ctx, { ns, caseId, counterpartyId: bundle.cargoParty._id, cents, kind, authority, filedAt: simNow, evidence: [{ kind: "CLAUSE", contractId: bundle.cargo.code, clause: "laytime" }], counterpartyStrategic: bundle.cargoParty.strategic, ...actorOf(task, bundle) });
    const facts = await currentFacts(ctx, ns, caseId);
    const completion = factValue<{ at: number }>(facts, "COMPLETION");
    if (completion && bundle.cargo.terms.timeBar) await ctx.db.patch(caseId, { timeBarAt: completion.at + bundle.cargo.terms.timeBar.days * DAY });
    return { filed: true, kind, cents, counterparty: bundle.cargoParty.name, waivedCents: statement.totals.totalCents - cents };
  },
});

export const postAp = internalMutation({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const bundle = await caseFor(ctx, task, input.caseCode);
    const ns = task.ns, caseId = bundle.case._id;
    if (await apPosted(ctx, ns, caseId)) return { posted: false, reason: "AP already posted" };
    const reconciliation = bundle.case.reconciliation as { payableCents: number; disputeCents: number; invoiceCode: string; statementVersion: number } | undefined;
    if (!reconciliation) fail("MISSING_EVIDENCE", "Reconcile the invoice first");
    const statement = await latestStatement(ctx, ns, caseId, "PAYABLE");
    if (!statement || statement.version !== reconciliation.statementVersion) return { posted: false, reason: "Statement changed since reconciliation; reconcile again" };
    const policies = await loadPolicies(ctx, ns);
    const delegation = await delegationContext(ctx, task, bundle);
    const route = routeAsk({ need: "PAYMENT", amountCents: reconciliation.payableCents, ctx: delegation, policies });
    let authority: Doc<"journalEntries">["authority"] = { kind: "DELEGATION", policyCode: "AP_POSTING" };
    if (route.required) {
      const asks = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
      const approval = asks.filter(ask => ask.kind === "PAYMENT_APPROVAL" && ask.status === "ANSWERED").pop();
      if (!approval) return { posted: false, needsAsk: { need: "PAYMENT", role: route.role, amountCents: reconciliation.payableCents } };
      if (approval.answer?.optionId !== "APPROVE") return { posted: false, rejected: true, reason: approval.answer?.reason };
      authority = { kind: "APPROVAL", askId: String(approval._id), personaId: String(approval.answeredBy) };
    }
    const simNow = await getSimNow(ctx, ns);
    const accrued = await accruedCents(ctx, ns, caseId);
    const evidence: EvidenceRef[] = [{ kind: "DOC", documentId: reconciliation.invoiceCode }];
    for (const [index, draft] of buildReversalAndAp(bundle.case.code, accrued, reconciliation.payableCents, bundle.owner._id).entries()) {
      await postJournalTx(ctx, { ns, draft, caseId, postedAt: simNow, idempotencyKey: `ap:${bundle.case.code}:${index}`, authority, evidence, delegation, ...actorOf(task, bundle) });
    }
    if (reconciliation.disputeCents > 0) await recordDisputeTx(ctx, { ns, caseId, counterpartyId: bundle.owner._id, cents: reconciliation.disputeCents, authority, filedAt: simNow, evidence, ...actorOf(task, bundle) });
    return { posted: true, payableCents: reconciliation.payableCents, accrualReversedCents: accrued, disputeCents: reconciliation.disputeCents };
  },
});

// ---------------------------------------------------------------- cases
const CASE_NUMBERING = { start: 398, step: 7 }; // Meridian's demurrage-desk case numbering for 2026

export const openCase = internalMutation({
  args: toolArgs, returns: v.any(),
  handler: async (ctx, { taskId, token, input }) => {
    const task = await taskFor(ctx, taskId, token);
    const simNow = await getSimNow(ctx, task.ns);
    const vessel = await ctx.db.query("vessels").withIndex("by_code", q => q.eq("ns", task.ns).eq("code", String(input.vesselCode))).unique();
    if (!vessel) fail("NOT_PERMITTED", "Unknown vessel");
    const event = task.triggerEventId ? await ctx.db.get(task.triggerEventId) : null;
    const portCode = (event?.payload as { portCode?: string } | undefined)?.portCode;
    const voyages = await ctx.db.query("voyages").withIndex("by_vessel", q => q.eq("ns", task.ns).eq("vesselId", vessel._id)).collect();
    const voyage = voyages.find(candidate => Math.abs(candidate.eta - simNow) <= 72 * HOUR);
    if (!voyage) fail("NOT_PERMITTED", `${vessel.name} has no voyage due within 72 h`);
    const port = await ctx.db.get(voyage.portId);
    if (portCode && port?.code !== portCode) fail("NOT_PERMITTED", `${vessel.name} is due at ${port?.name}, not the notice's port`);
    const existing = await ctx.db.query("cases").withIndex("by_voyage", q => q.eq("ns", task.ns).eq("voyageId", voyage._id)).first();
    if (existing) return { caseCode: existing.code, existing: true };
    const opened = (await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", task.ns)).collect()).filter(item => item.origin !== "HISTORY_IMPORT").length;
    const code = `DC-2026-${String(CASE_NUMBERING.start + CASE_NUMBERING.step * opened).padStart(4, "0")}`;
    const caseId = await ctx.db.insert("cases", { ns: task.ns, origin: "AGENT", code, voyageId: voyage._id, status: "WORKING", openedAt: simNow, statusLine: String(input.reason ?? "Opened").slice(0, 48), correlationId: `case:${code}`, updatedAt: Date.now() });
    await ctx.db.patch(taskId, { caseId });
    const step = await currentStep(ctx, task);
    if (step) await ctx.db.patch(step._id, { caseId });
    await appendAudit(ctx, { ns: task.ns, origin: "AGENT", actor: `agent:${task._id}`, role: "agent", type: "CASE_OPENED", entityType: "case", entityId: code, correlationId: `case:${code}`, after: { vessel: vessel.code, voyage: voyage.code }, at: simNow });
    return { caseCode: code, vessel: vessel.name, port: port?.name, eta: voyage.eta };
  },
});

// ---------------------------------------------------------------- runtime bookkeeping
/** A procedure-granted capability was used: the step cites the memory item (T-08) and the item records the case. */
export const noteMemoryUse = internalMutation({
  args: { taskId: v.id("agentTasks"), token: v.string(), memoryCode: v.string() },
  returns: v.null(),
  handler: async (ctx, { taskId, token, memoryCode }) => {
    const task = await taskFor(ctx, taskId, token);
    const step = await currentStep(ctx, task);
    if (step && !step.memoryRefs.includes(memoryCode)) await ctx.db.patch(step._id, { memoryRefs: [...step.memoryRefs, memoryCode] });
    const item = await ctx.db.query("memoryItems").withIndex("by_code", q => q.eq("ns", task.ns).eq("code", memoryCode)).unique();
    if (item && task.caseId && !item.usedIn.includes(task.caseId)) await ctx.db.patch(item._id, { usedIn: [...item.usedIn, task.caseId] });
    return null;
  },
});

export const renewLease = internalMutation({
  args: { taskId: v.id("agentTasks"), token: v.string(), leaseMs: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { taskId, token, leaseMs }) => {
    const task = await ctx.db.get(taskId);
    if (!task || task.state !== "RUNNING" || task.leaseToken !== token || (task.leaseUntil ?? 0) <= Date.now()) return false;
    await ctx.db.patch(taskId, { leaseUntil: Date.now() + leaseMs });
    return true;
  },
});

/** Manual retry of a FAILED or NEEDS_REVIEW task (T-22: a retry after the model recovers succeeds). */
export const retryTask = internalMutation({
  args: { taskId: v.id("agentTasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task || (task.state !== "FAILED" && task.state !== "NEEDS_REVIEW")) return null;
    await ctx.db.patch(taskId, { state: "QUEUED", attempt: 0, error: undefined, updatedAt: Date.now() });
    await scheduleTask(ctx, taskId);
    return null;
  },
});
export const leaseTask = internalMutation({
  args: { taskId: v.id("agentTasks"), leaseMs: v.number() },
  returns: v.union(v.null(), v.object({ token: v.string(), ns: v.string(), kind: v.string(), caseId: v.optional(v.id("cases")), caseCode: v.optional(v.string()), attempt: v.number(), event: v.any(), ask: v.any() })),
  handler: async (ctx, { taskId, leaseMs }) => {
    const task = await ctx.db.get(taskId);
    if (!task || task.state !== "QUEUED") return null;
    const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    await ctx.db.patch(taskId, { state: "RUNNING", leaseToken: token, leaseUntil: Date.now() + leaseMs, attempt: task.attempt + 1, updatedAt: Date.now() });
    if (task.caseId) await ctx.db.patch(task.caseId, { status: "WORKING", updatedAt: Date.now() });
    const event = task.triggerEventId ? await ctx.db.get(task.triggerEventId) : null;
    const ask = task.triggerAskId ? await ctx.db.get(task.triggerAskId) : null;
    const caseCode = task.caseId ? (await ctx.db.get(task.caseId))?.code : undefined;
    return { token, ns: task.ns, kind: task.kind, attempt: task.attempt + 1, ...(caseCode ? { caseCode } : {}), event: event && { type: event.type, payload: event.payload, scheduledAt: event.scheduledAt }, ask: ask && { code: ask.code, kind: ask.kind, role: ask.role, question: ask.question, answer: ask.answer }, ...(task.caseId ? { caseId: task.caseId } : {}) };
  },
});

export const finishTask = internalMutation({
  args: { taskId: v.id("agentTasks"), token: v.string(), state: v.union(v.literal("SUCCEEDED"), v.literal("NEEDS_REVIEW"), v.literal("FAILED"), v.literal("QUEUED")), error: v.optional(v.string()), model: v.optional(v.string()), tokensIn: v.optional(v.number()), tokensOut: v.optional(v.number()), cacheRead: v.optional(v.number()), cacheWrite: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { taskId, token, state, error, model, tokensIn, tokensOut, cacheRead, cacheWrite }) => {
    const task = await ctx.db.get(taskId);
    if (!task || task.leaseToken !== token) return null;
    const step = await currentStep(ctx, task);
    if (step?.status === "RUNNING") await ctx.db.patch(step._id, { status: state === "SUCCEEDED" ? "DONE" : state === "QUEUED" ? "RUNNING" : "FAILED" });
    let final: Doc<"agentTasks">["state"] = state;
    if (task.caseId && state === "SUCCEEDED") {
      const line = await statusLineFor(ctx, task.ns, task.caseId);
      if (line.status === "WAITING_HUMAN") final = "WAITING_HUMAN";
      await ctx.db.patch(task.caseId, { ...line, updatedAt: Date.now() });
    } else if (task.caseId && (state === "FAILED" || state === "NEEDS_REVIEW")) {
      await ctx.db.patch(task.caseId, { status: "NEEDS_REVIEW", statusLine: state === "FAILED" ? "Paused · model unavailable" : "Needs review", updatedAt: Date.now() });
    }
    await ctx.db.patch(taskId, { state: final, leaseToken: undefined, leaseUntil: undefined, updatedAt: Date.now(), ...(error ? { error: error.slice(0, 500) } : {}), ...(model ? { model } : {}), tokensIn: (task.tokensIn ?? 0) + (tokensIn ?? 0), tokensOut: (task.tokensOut ?? 0) + (tokensOut ?? 0), cacheRead: (task.cacheRead ?? 0) + (cacheRead ?? 0), cacheWrite: (task.cacheWrite ?? 0) + (cacheWrite ?? 0) });
    return null;
  },
});

/** Postcondition snapshot for CONTRACTS §9 (built from the database, not from the model). */
export const postconditionSnapshot = internalQuery({
  args: { taskId: v.id("agentTasks") },
  returns: v.any(),
  handler: async (ctx, { taskId }) => {
    const task = (await ctx.db.get(taskId))!;
    const ns = task.ns;
    const event = task.triggerEventId ? await ctx.db.get(task.triggerEventId) : null;
    const base = { factKeys: [] as string[], intervals: [] as { kind: string; verified: boolean; hasOpenAsk: boolean }[], statementVersions: {} as Record<string, number>, openAskKinds: [] as string[] };
    if (task.kind === "MONTH_END") {
      const cases = (await ctx.db.query("cases").withIndex("by_ns", q => q.eq("ns", ns)).collect()).filter(item => item.status !== "CLOSED" && item.origin !== "HISTORY_IMPORT");
      const candidates: string[] = [], handled: string[] = [];
      const periodCode = (event?.payload as { periodCode?: string } | undefined)?.periodCode;
      for (const item of cases) {
        const facts = await currentFacts(ctx, ns, item._id);
        if (!factValue(facts, "LAYTIME_START_PAYABLE") || await apPosted(ctx, ns, item._id)) continue;
        candidates.push(item.code);
        const entries = await ctx.db.query("journalEntries").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", item._id)).collect();
        const posted = entries.some(entry => entry.idempotencyKey === `accrual:${item.code}:${periodCode}`);
        const unchanged = await ctx.db.query("auditEvents").withIndex("by_entity", q => q.eq("entityId", `accrual:${item.code}:${periodCode}`)).filter(q => q.and(q.eq(q.field("ns"), ns), q.eq(q.field("type"), "ACCRUAL_UNCHANGED"))).first();
        if (posted || unchanged) handled.push(item.code);
      }
      return { ...base, monthEnd: { candidateCaseIds: candidates, handledCaseIds: handled } };
    }
    if (task.kind === "FLEET_SCAN") {
      const portCode = (event?.payload as { portCode?: string } | undefined)?.portCode;
      const port = portCode ? await ctx.db.query("ports").withIndex("by_code", q => q.eq("ns", ns).eq("code", portCode)).unique() : null;
      const simNow = await getSimNow(ctx, ns);
      const voyages = await ctx.db.query("voyages").withIndex("by_ns", q => q.eq("ns", ns)).collect();
      const due = voyages.filter(voyage => voyage.portId === port?._id && Math.abs(voyage.eta - simNow) <= 72 * HOUR);
      const handled = [];
      for (const voyage of due) if (await ctx.db.query("cases").withIndex("by_voyage", q => q.eq("ns", ns).eq("voyageId", voyage._id)).first()) handled.push(String(voyage.vesselId));
      return { ...base, fleetScan: { candidateVesselIds: due.map(voyage => String(voyage.vesselId)), handledVesselIds: handled } };
    }
    const caseId = task.caseId;
    if (!caseId) return base;
    const bundle = await loadCase(ctx, caseId);
    const facts = await currentFacts(ctx, ns, caseId);
    const asks = await ctx.db.query("asks").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
    const openAsks = asks.filter(ask => ask.status === "OPEN");
    const item = (await ctx.db.get(caseId))!;
    const payload = event?.payload as { documentCode?: string } | undefined;
    const document = payload?.documentCode ? await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", ns).eq("code", payload.documentCode!)).unique() : null;
    const filings = await ctx.db.query("filings").withIndex("by_case", q => q.eq("ns", ns).eq("caseId", caseId)).collect();
    // What the agent could see by now: sim-time-scoped AIS through the same capability as get_ais.
    const points = task.kind === "AIS_UPDATE" ? await aisPoints(ctx, task, bundle) : [];
    const arrivalAt = points.length ? detectGeofenceEntry(points, bundle.port.anchorage) : null;
    const movements = arrivalAt ? detectMovementIntervals(points.filter(point => point.at >= arrivalAt)) : [];
    const shiftFacts = intervalFacts(facts).filter(interval => interval.kind === "SHIFTING");
    const sofExtraction = document?.kind === "SOF" ? await ctx.db.query("extractions").withIndex("by_document", q => q.eq("ns", ns).eq("documentId", document._id)).first() : null;
    const sofFields = sofExtraction?.fields as { rows?: unknown[]; mappedRows?: number[] } | undefined;
    const trigger = task.triggerAskId ? await ctx.db.get(task.triggerAskId) : null;
    return {
      ...base,
      factKeys: [...new Set(facts.map(fact => fact.key))],
      intervals: intervalFacts(facts).map(interval => ({ kind: interval.kind, verified: interval.verified, hasOpenAsk: openAsks.some(ask => ask.kind === "CONFIRM_FACT") })),
      statementVersions: { PAYABLE: (await latestStatement(ctx, ns, caseId, "PAYABLE"))?.version ?? 0, RECOVERABLE: (await latestStatement(ctx, ns, caseId, "RECOVERABLE"))?.version ?? 0 },
      documentKind: document?.kind,
      closureRecorded: document?.kind === "PORT_CLOSURE" ? facts.some(fact => fact.key === "INTERVAL" && (fact.value as IntervalFactForClosure).kind === "PORT_CLOSURE" && (fact.value as IntervalFactForClosure).verified && fact.evidence.some(ref => ref.kind === "DOC" && ref.documentId === document.code)) : undefined,
      reconciliation: Boolean(item.reconciliation),
      apPosted: await apPosted(ctx, ns, caseId),
      openAskKinds: openAsks.map(ask => ask.kind),
      recoveryRequired: ((await latestStatement(ctx, ns, caseId, "RECOVERABLE"))?.totals.totalCents ?? 0) > 0,
      filingExists: filings.some(filing => filing.kind === "RECOVERY_CLAIM" || filing.kind === "PROTECTIVE_NOTICE"),
      ...(sofFields ? { sof: { rows: sofFields.rows?.length ?? 0, mapped: sofFields.mappedRows?.length ?? 0 } } : {}),
      // Applied = the case moved after the answer: a filing, AP, an applied fact or a "no action" answer.
      askApplied: task.kind === "ASK_ANSWERED" ? Boolean(trigger && (
        trigger.kind === "COMMERCIAL_DECISION" ? trigger.answer?.optionId === "WAIVE" || filings.some(filing => filing.kind === "RECOVERY_CLAIM" || filing.kind === "PROTECTIVE_NOTICE") :
        trigger.kind === "PAYMENT_APPROVAL" ? trigger.answer?.optionId === "REJECT" || await apPosted(ctx, ns, caseId) :
        trigger.kind === "CONFIRM_FACT" ? trigger.answer?.optionId === "CANT_FIND" || intervalFacts(facts).every(interval => interval.verified) : false
      )) : undefined,
      aisBatch: task.kind === "AIS_UPDATE" ? { entryDetected: arrivalAt !== null, entryRecorded: Boolean(factValue(facts, "ARRIVAL_IN_PORT_LIMITS")), movements: movements.length, movementsRecorded: Math.min(movements.length, shiftFacts.length) } : undefined,
    };
  },
});

export const capabilitiesForTask = internalQuery({
  args: { taskId: v.id("agentTasks") },
  returns: v.any(),
  handler: async (ctx, { taskId }) => {
    const task = (await ctx.db.get(taskId))!;
    const { capabilities, procedures } = await capabilitiesFor(ctx, task.ns, task.caseId);
    return { capabilities, procedures };
  },
});

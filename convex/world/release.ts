// World scripts: attach (create worldEvents) and release (write source records, audit, enqueue agent tasks).
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { appendAudit } from "../lib/audit";
import { onWorldEvent } from "../orchestrator";
import { SCRIPTS } from "../../src/world/scripts";

export function scriptDef(code: string) {
  const script = SCRIPTS.find(candidate => candidate.code === code);
  if (!script) throw new Error(`Unknown world script ${code}`);
  return script;
}

/**
 * Creates the script's worldEvents and marks it ACTIVE. Documents carry absolute receivedAt times, so a script can only
 * be attached at its default anchor (the demo baseline for RTM-STORM-2026-10). Idempotent: an attached script is left as is.
 */
export async function attachScript(ctx: MutationCtx, ns: string, code: string) {
  const script = scriptDef(code);
  const row = await ctx.db.query("worldScripts").withIndex("by_code", q => q.eq("ns", ns).eq("code", code)).unique();
  if (!row) throw new Error(`World script ${code} not imported in ${ns}`);
  if (row.status !== "IDLE") return { attached: false, lastAt: script.events[script.events.length - 1].at };
  for (const event of script.events) {
    await ctx.db.insert("worldEvents", { ns, origin: "WORLD_SCRIPT", scriptCode: code, seq: event.seq, type: event.type, scheduledAt: event.at, payload: event.payload });
  }
  await ctx.db.patch(row._id, { status: "ACTIVE", anchorAt: script.defaultAnchorAt });
  await appendAudit(ctx, { ns, origin: "SYSTEM", actor: "system", role: "agent", type: "WORLD_SCRIPT_ATTACHED", entityType: "worldScript", entityId: code, correlationId: `script:${code}`, details: { events: script.events.length } });
  return { attached: true, lastAt: script.events[script.events.length - 1].at };
}

/** The next unreleased event across all attached scripts (by scheduled time, then sequence). */
export async function nextUnreleased(ctx: MutationCtx, ns: string) {
  const candidates = await ctx.db.query("worldEvents").withIndex("by_unreleased", q => q.eq("ns", ns).eq("releasedAt", undefined)).take(50);
  return candidates.sort((a, b) => a.scheduledAt - b.scheduledAt || a.scriptCode.localeCompare(b.scriptCode) || a.seq - b.seq)[0] ?? null;
}

async function idOf(ctx: MutationCtx, table: "vessels" | "ports" | "documents", ns: string, code: string) {
  const row = await ctx.db.query(table as "vessels").withIndex("by_code", q => q.eq("ns", ns).eq("code", code)).unique();
  if (!row) throw new Error(`${table} ${code} missing in ${ns}`);
  return row._id;
}

/** Writes the event's source records at its scheduled sim time, audits it, and enqueues agent tasks. */
export async function releaseEvent(ctx: MutationCtx, event: Doc<"worldEvents">) {
  const ns = event.ns;
  const payload = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "AIS_BATCH": {
      const vesselId = await idOf(ctx, "vessels", ns, String(payload.vesselCode));
      for (const point of payload.points as { at: number; lon: number; lat: number; sogKn: number; cogDeg: number }[]) {
        await ctx.db.insert("aisPoints", { ns, origin: "WORLD_SCRIPT", vesselId, at: point.at, lon: point.lon, lat: point.lat, sogKn: point.sogKn, cogDeg: point.cogDeg });
      }
      break;
    }
    case "EMAIL": {
      const documentId = await idOf(ctx, "documents", ns, String(payload.documentCode));
      await ctx.db.insert("mailMessages", { ns, origin: "WORLD_SCRIPT", documentId: documentId as never, from: String(payload.from), subject: String(payload.subject), receivedAt: event.scheduledAt, vesselImo: String(payload.vesselImo), bodyText: String(payload.bodyText) });
      break;
    }
    case "CUSTOMS_RECORD": {
      await ctx.db.insert("customsRecords", {
        ns, origin: "WORLD_SCRIPT",
        portId: await idOf(ctx, "ports", ns, String(payload.portCode)) as never,
        vesselId: await idOf(ctx, "vessels", ns, String(payload.vesselCode)),
        kind: payload.kind as "HOLD" | "RELEASE", startAt: Number(payload.startAt),
        ...(payload.endAt !== undefined ? { endAt: Number(payload.endAt) } : {}),
        documentId: await idOf(ctx, "documents", ns, String(payload.documentCode)) as never,
      });
      break;
    }
    case "PERIOD_LOCK": {
      const period = await ctx.db.query("periods").withIndex("by_code", q => q.eq("ns", ns).eq("code", String(payload.periodCode))).unique();
      if (period && period.status !== "LOCKED") {
        await ctx.db.patch(period._id, { status: "LOCKED" });
        await appendAudit(ctx, { ns, origin: "SYSTEM", actor: "system", role: "agent", type: "PERIOD_LOCKED", entityType: "period", entityId: period.code, correlationId: `period:${period.code}`, before: { status: period.status }, after: { status: "LOCKED" }, at: event.scheduledAt });
      }
      break;
    }
    default: break;
  }
  await ctx.db.patch(event._id, { releasedAt: event.scheduledAt });
  await appendAudit(ctx, { ns, origin: "WORLD_SCRIPT", actor: "system", role: "agent", type: "WORLD_EVENT_RELEASED", entityType: "worldEvent", entityId: `${event.scriptCode}#${event.seq}`, correlationId: `script:${event.scriptCode}`, details: { type: event.type }, at: event.scheduledAt });
  const tasks = await onWorldEvent(ctx, { ...event, releasedAt: event.scheduledAt });
  // A script is DONE once all its events are released.
  const remaining = await ctx.db.query("worldEvents").withIndex("by_script_seq", q => q.eq("ns", ns).eq("scriptCode", event.scriptCode)).filter(q => q.eq(q.field("releasedAt"), undefined)).first();
  if (!remaining) {
    const row = await ctx.db.query("worldScripts").withIndex("by_code", q => q.eq("ns", ns).eq("code", event.scriptCode)).unique();
    if (row && row.status !== "DONE") await ctx.db.patch(row._id, { status: "DONE" });
  }
  return tasks;
}

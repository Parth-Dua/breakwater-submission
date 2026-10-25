import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { appendAudit } from "./lib/audit";
import { fail } from "./lib/errors";
import { currentPersona, ensurePersonas, personaByCode } from "./lib/persona";
import { personaCode, role, selectablePersonaCode } from "./lib/validators";
import { DEMO_NS, personaDefinition } from "../src/world/personas";

const personaView = v.object({ code: personaCode, displayName: v.string(), role });

/** The caller's acting persona. Default Observer (also before sign-in completes). */
export const me = query({
  args: {},
  returns: v.object({ persona: personaView }),
  handler: async ctx => {
    const acting = await currentPersona(ctx);
    if (acting) return { persona: { code: acting.persona.code, displayName: acting.persona.displayName, role: acting.persona.role } };
    const observer = personaDefinition("OBSERVER");
    return { persona: { code: observer.code, displayName: observer.displayName, role: observer.role } };
  },
});

/** Role toggle. The only mutation an Observer may call. Audited as ACTING_AS_CHANGED. */
export const setActingAs = mutation({
  args: { code: selectablePersonaCode, automation: v.optional(v.boolean()) },
  returns: personaView,
  handler: async (ctx, { code, automation }) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) fail("NOT_PERMITTED", "Sign-in has not completed");
    await ensurePersonas(ctx, DEMO_NS);
    const next = await personaByCode(ctx, code, DEMO_NS);
    if (!next) fail("NOT_PERMITTED", "Unknown persona");
    const previous = await currentPersona(ctx);
    const now = Date.now(), origin = automation ? "AUTOMATED_TEST" as const : "HUMAN" as const;
    if (previous) {
      if (previous.persona._id === next._id) return { code: next.code, displayName: next.displayName, role: next.role };
      await ctx.db.patch(previous.sessionId, { actingPersonaId: next._id, updatedAt: now });
    } else {
      const existing = await ctx.db.query("demoSessions").withIndex("by_auth_user", q => q.eq("authUserId", authUserId)).unique();
      if (existing) await ctx.db.patch(existing._id, { actingPersonaId: next._id, updatedAt: now });
      else await ctx.db.insert("demoSessions", { ns: DEMO_NS, origin, authUserId, actingPersonaId: next._id, updatedAt: now });
    }
    const fromCode = previous?.persona.code ?? "OBSERVER";
    await appendAudit(ctx, {
      ns: DEMO_NS, origin,
      actor: `persona:${fromCode}`, role: previous?.persona.role ?? "observer",
      type: "ACTING_AS_CHANGED", entityType: "demoSession", entityId: authUserId,
      correlationId: `session:${authUserId}`,
      before: { persona: fromCode }, after: { persona: next.code },
    });
    return { code: next.code, displayName: next.displayName, role: next.role };
  },
});

/** Idempotent persona seed for a namespace (used by world import and tests). */
export const seedPersonas = internalMutation({
  args: { ns: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { ns }) => { await ensurePersonas(ctx, ns ?? DEMO_NS); return null; },
});

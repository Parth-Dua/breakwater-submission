import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DEMO_NS, PERSONAS, type PersonaCode, type Role } from "../../src/world/personas";
import { fail } from "./errors";

export type ActingPersona = { persona: Doc<"personas">; authUserId: Id<"users">; sessionId: Id<"demoSessions"> };

/** Idempotently creates the demo personas (WORLD §1.1). */
export async function ensurePersonas(ctx: MutationCtx, ns: string = DEMO_NS) {
  for (const definition of PERSONAS) {
    const existing = await ctx.db.query("personas").withIndex("by_code", q => q.eq("ns", ns).eq("code", definition.code)).unique();
    if (!existing) await ctx.db.insert("personas", { ns, origin: "SYSTEM", code: definition.code, displayName: definition.displayName, role: definition.role });
  }
}

export async function personaByCode(ctx: QueryCtx, code: PersonaCode, ns: string = DEMO_NS) {
  return ctx.db.query("personas").withIndex("by_code", q => q.eq("ns", ns).eq("code", code)).unique();
}

/** Resolves the caller's acting persona from the server-side session. Never trusts client-sent roles. */
export async function currentPersona(ctx: QueryCtx): Promise<ActingPersona | null> {
  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) return null;
  const session = await ctx.db.query("demoSessions").withIndex("by_auth_user", q => q.eq("authUserId", authUserId)).unique();
  if (!session) return null;
  const persona = await ctx.db.get(session.actingPersonaId);
  if (!persona) return null;
  return { persona, authUserId, sessionId: session._id };
}

/** Guard for human mutations (CONTRACTS §13.2). Observer can never mutate through this guard. */
export async function requirePersona(ctx: QueryCtx, roles: readonly Exclude<Role, "agent" | "observer">[]): Promise<ActingPersona> {
  const acting = await currentPersona(ctx);
  if (!acting) fail("NOT_PERMITTED", "Choose who you are acting as");
  if (!(roles as readonly Role[]).includes(acting.persona.role)) fail("WRONG_ROLE", `${acting.persona.displayName} cannot do this`);
  return acting;
}

import type { Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { chainHash, GENESIS_HASH } from "../../src/domain/canonical";
import { getSimNow } from "./clock";
import type { evidenceRef, origin, role } from "./validators";

export type AuditInput = {
  ns: string;
  origin: Infer<typeof origin>;
  actor: string;                 // agent:<taskId> | persona:<code> | system
  role: Infer<typeof role>;
  type: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  before?: unknown;
  after?: unknown;
  evidence?: Infer<typeof evidenceRef>[];
  details?: unknown;
  at?: number;                   // sim time; defaults to the namespace clock
};

/** Append-only, hash-chained audit write (ARCHITECTURE §8). Call inside the mutation that makes the change. */
export async function appendAudit(ctx: MutationCtx, input: AuditInput) {
  const last = await ctx.db.query("auditEvents").withIndex("by_ns_seq", q => q.eq("ns", input.ns)).order("desc").first();
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const at = input.at ?? await getSimNow(ctx, input.ns);
  const event = {
    ns: input.ns, origin: input.origin, seq, prevHash, at, wallAt: Date.now(),
    actor: input.actor, role: input.role, type: input.type, entityType: input.entityType,
    entityId: input.entityId, correlationId: input.correlationId,
    before: input.before, after: input.after, evidence: input.evidence, details: input.details ?? {},
  };
  const hash = chainHash(prevHash, event);
  return ctx.db.insert("auditEvents", { ...event, hash });
}

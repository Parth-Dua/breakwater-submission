// Audit chain verification (ARCHITECTURE §8, REQ-AUD-01). Recomputes every hash in sequence.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { chainHash, GENESIS_HASH } from "../src/domain/canonical";
import { DEMO_NS } from "../src/world/personas";

export async function verifyChainFor(ctx: QueryCtx, ns: string): Promise<{ ok: boolean; length: number; firstBadSeq?: number }> {
  let prev = GENESIS_HASH, length = 0, expectedSeq = 1;
  for await (const event of ctx.db.query("auditEvents").withIndex("by_ns_seq", q => q.eq("ns", ns))) {
    const { _id, _creationTime, hash, ...body } = event as Doc<"auditEvents">;
    void _id; void _creationTime;
    if (event.seq !== expectedSeq || event.prevHash !== prev || chainHash(prev, body) !== hash) return { ok: false, length, firstBadSeq: event.seq };
    prev = hash; length++; expectedSeq++;
  }
  return { ok: true, length };
}

/** Proof tab: "✓ 1,284 events verified" (UI §4.4). */
export const verifyChain = query({
  args: { ns: v.optional(v.string()) },
  returns: v.object({ ok: v.boolean(), length: v.number(), firstBadSeq: v.optional(v.number()) }),
  handler: async (ctx, { ns }) => verifyChainFor(ctx, ns ?? DEMO_NS),
});

import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Deadline projection also covers an unfiled claim, before the gateway persists its deadline. */
export async function caseTimeBar(ctx: QueryCtx, item: Doc<"cases">, cargo?: Doc<"contracts">): Promise<number | null> {
  if (item.timeBarAt !== undefined) return item.timeBarAt;
  const voyage = cargo ? null : await ctx.db.get(item.voyageId);
  const contract = cargo ?? (voyage ? await ctx.db.get(voyage.cargoContractId) : null);
  if (!contract?.terms.timeBar) return null;
  const facts = await ctx.db.query("facts").withIndex("by_case_key", q => q.eq("ns", item.ns).eq("caseId", item._id).eq("key", "COMPLETION")).collect();
  const completion = facts.find(fact => fact.key === "COMPLETION" && fact.supersededBy === undefined)?.value as { at: number } | undefined;
  return completion ? completion.at + contract.terms.timeBar.days * 86_400_000 : null;
}

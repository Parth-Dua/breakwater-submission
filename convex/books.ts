import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { getSimNow } from "./lib/clock";
import { accountsCatalog, type AccountCode } from "../src/domain/ledger";
import { sumCents } from "../src/domain/money";
import { DEMO_NS } from "../src/world/personas";

export type AccountRow = { code: AccountCode; name: string; debitCents: number; creditCents: number };
export type JournalRow = { code: string; at: number; period: string; kind: string; caseCode: string | null; vessel: string | null; cents: number; authority: string; lines: { account: AccountCode; name: string; counterparty: string | null; side: "DEBIT" | "CREDIT"; cents: number }[]; evidence: { label: string; kind: string }[] };

/** All balances are journal-derived and scoped to company time. No statement estimate becomes a book balance. */
export async function readLedger(ctx: QueryCtx, ns: string) {
  const now = await getSimNow(ctx, ns);
  const entries = (await ctx.db.query("journalEntries").withIndex("by_ns", q => q.eq("ns", ns)).collect()).filter(entry => entry.postedAt <= now);
  const entryIds = new Set(entries.map(entry => String(entry._id)));
  const lines = (await ctx.db.query("journalLines").withIndex("by_ns", q => q.eq("ns", ns)).collect()).filter(line => entryIds.has(String(line.entryId)));
  const signed = (account: AccountCode) => sumCents(lines.filter(line => line.account === account).map(line => line.side === "DEBIT" ? line.cents : -line.cents));
  return { now, entries, lines, signed };
}

export const trialBalance = query({
  args: {}, returns: v.any(),
  handler: async (ctx): Promise<{ accounts: AccountRow[]; debitCents: number; creditCents: number; balanced: boolean }> => {
    const ledger = await readLedger(ctx, DEMO_NS);
    const accounts = (Object.entries(accountsCatalog) as [AccountCode, typeof accountsCatalog[AccountCode]][]).map(([code, definition]) => {
      const balance = ledger.signed(code);
      return { code, name: definition.name.replace(/ \(.*\)/, ""), debitCents: Math.max(0, balance), creditCents: Math.max(0, -balance) };
    });
    const debitCents = sumCents(accounts.map(account => account.debitCents)), creditCents = sumCents(accounts.map(account => account.creditCents));
    return { accounts, debitCents, creditCents, balanced: debitCents === creditCents };
  },
});

export const journals = query({
  args: { filter: v.optional(v.union(v.literal("THIS_QUARTER"), v.literal("ALL"))) }, returns: v.any(),
  handler: async (ctx, { filter }): Promise<JournalRow[]> => {
    const ns = DEMO_NS, ledger = await readLedger(ctx, ns);
    const date = new Date(ledger.now), quarterStart = Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1);
    const entries = ledger.entries.filter(entry => filter === "ALL" || entry.postedAt >= quarterStart).sort((a, b) => b.postedAt - a.postedAt || b.code.localeCompare(a.code));
    const parties = new Map((await ctx.db.query("counterparties").withIndex("by_ns", q => q.eq("ns", ns)).collect()).map(party => [String(party._id), party.name.split(/\s+/)[0]]));
    const result: JournalRow[] = [];
    for (const entry of entries) {
      const item = entry.caseId ? await ctx.db.get(entry.caseId) : null;
      const voyage = item ? await ctx.db.get(item.voyageId) : null;
      const vessel = voyage ? await ctx.db.get(voyage.vesselId) : null;
      const approver = entry.authority.kind === "APPROVAL" ? await ctx.db.get(entry.authority.personaId as never) as { displayName?: string } | null : null;
      const lines = ledger.lines.filter(line => line.entryId === entry._id);
      const evidence = [];
      for (const ref of entry.evidence) {
        if (ref.kind === "DOC") {
          const document = await ctx.db.query("documents").withIndex("by_code", q => q.eq("ns", ns).eq("code", ref.documentId)).unique();
          evidence.push({ kind: ref.kind, label: document?.title ?? "Document" });
        } else evidence.push({ kind: ref.kind, label: ref.kind === "CLAUSE" ? `Clause ${ref.clause}` : ref.kind === "AIS" ? "AIS" : ref.kind === "ASK" ? "Approval" : ref.kind === "MEMORY" ? "Memory" : "Journal" });
      }
      result.push({ code: entry.code, at: entry.postedAt, period: entry.periodCode, kind: entry.kind, caseCode: item?.code ?? null, vessel: vessel?.name.replace(/^MV\s+/, "") ?? null,
        cents: sumCents(lines.filter(line => line.side === "DEBIT").map(line => line.cents)), authority: approver?.displayName ?? (entry.authority.kind === "IMPORTED" ? "Imported" : "Delegation"),
        lines: lines.map(line => ({ account: line.account, name: accountsCatalog[line.account].name.replace(/ \(.*\)/, ""), side: line.side, cents: line.cents, counterparty: line.counterpartyId ? parties.get(String(line.counterpartyId)) ?? null : null })), evidence });
    }
    return result;
  },
});

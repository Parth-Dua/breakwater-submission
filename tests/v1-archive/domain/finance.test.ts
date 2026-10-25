import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { allocateClaimCents,centsForMinutes } from "@/domain/money";
import { reconcileClaim,type CharterTerms,type SourceEvidence } from "@/domain/charters";
import { acceptedInvoiceLines,checkPostingAuthority,validateJournal,type JournalLine } from "@/domain/ledger";
import { internal } from "../../convex/_generated/api";
import { preparedFinance } from "../helpers/finance";
const minute=60_000;
const charter:CharterTerms={version:1,rateCentsPerDay:1_000_000,payableCauses:["PORT_CLOSURE"],excludedCauses:["CUSTOMS"],effectiveFrom:0,effectiveTo:10_000*minute};
const evidence:SourceEvidence[]=[{id:"port",voyageId:"voyage",type:"PORT_NOTICE",signed:true,cause:"PORT_CLOSURE",startAt:0,endAt:1440*minute},{id:"log",voyageId:"voyage",type:"SIGNED_OPS_LOG",signed:true,cause:"CUSTOMS",startAt:1440*minute,endAt:4320*minute}];
const segments=evidence.map(source=>({startAt:source.startAt,endAt:source.endAt,cause:source.cause,evidenceIds:[source.id]}));
const input={voyageId:"voyage",interval:{startAt:0,endAt:4320*minute},claimedCents:3_000_000,expectedCharterVersion:1,charter,segments,evidence};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(Date.UTC(2026,9,24));});
afterEach(()=>vi.useRealTimers());
describe("deterministic financial controls",()=>{
  it("F16 calculates exact cents and rounds once without losing the partition",()=>{
    expect(centsForMinutes(90,1_000_000)).toBe(62_500);
    expect(centsForMinutes(720,1)).toBe(1);
    expect(allocateClaimCents({supported:1,unverified:1,disputed:0},720)).toEqual({claimedCents:1,supportedCents:0,unverifiedCents:1,disputedCents:0});
    expect(()=>centsForMinutes(2,Number.MAX_SAFE_INTEGER)).not.toThrow();
    expect(()=>centsForMinutes(1441,Number.MAX_SAFE_INTEGER)).toThrow();
    expect(()=>centsForMinutes(1.5,100)).toThrow();
  });
  it("preserves uncertainty and applies each voyage's actual charter",()=>{
    expect(reconcileClaim({...input,segments:segments.slice(0,1)})).toMatchObject({supportedCents:1_000_000,unverifiedCents:2_000_000,disputedCents:0});
    expect(reconcileClaim(input)).toMatchObject({supportedCents:1_000_000,unverifiedCents:0,disputedCents:2_000_000});
    expect(reconcileClaim({...input,charter:{...charter,payableCauses:["PORT_CLOSURE","CUSTOMS"],excludedCauses:[]}})).toMatchObject({supportedCents:3_000_000,unverifiedCents:0,disputedCents:0});
  });
  it("rejects invalid evidence, wrong charter versions and overlapping intervals",()=>{
    for(const badLog of [{...evidence[1],signed:false},{...evidence[1],voyageId:"other"},{...evidence[1],endAt:2000*minute}])expect(()=>reconcileClaim({...input,evidence:[evidence[0],badLog]})).toThrow();
    expect(()=>reconcileClaim({...input,evidence:evidence.slice(0,1)})).toThrow();
    expect(()=>reconcileClaim({...input,expectedCharterVersion:2})).toThrow();
    expect(()=>reconcileClaim({...input,charter:{...charter,effectiveFrom:1}})).toThrow();
    expect(()=>reconcileClaim({...input,charter:{...charter,effectiveTo:NaN}})).toThrow();
    expect(()=>reconcileClaim({...input,segments:[segments[0],{...segments[1],startAt:1000*minute}]})).toThrow();
  });
  it("derives the exact four-line reversal/AP journal and refuses invalid lines",()=>{
    const lines=acceptedInvoiceLines(1_500_000,1_000_000);
    expect(lines).toEqual([{accountCode:"ACCRUED_LIABILITY",side:"DEBIT",amountCents:1_500_000},{accountCode:"VOYAGE_EXPENSE",side:"CREDIT",amountCents:1_500_000},{accountCode:"VOYAGE_EXPENSE",side:"DEBIT",amountCents:1_000_000},{accountCode:"ACCOUNTS_PAYABLE",side:"CREDIT",amountCents:1_000_000}]);
    expect(validateJournal(lines)).toEqual({debits:2_500_000,credits:2_500_000});
    expect(()=>validateJournal([{...lines[0],amountCents:1},lines[1]])).toThrow();
    expect(()=>validateJournal([{...lines[0],amountCents:0},lines[1]])).toThrow();
    expect(()=>validateJournal([{...lines[0],accountCode:"CASH"} as unknown as JournalLine,lines[1]])).toThrow();
  });
  it("approval never bypasses invoice, evidence or period checks",()=>{
    const policy={invoiceAccepted:true,evidenceVerified:true,periodOpen:true,invoiceCents:1_000_000,accrualCents:1_500_000,invoiceLimit:1_200_000,accrualLimit:2_000_000,controllerApproved:false};
    expect(()=>checkPostingAuthority(policy)).not.toThrow();
    expect(()=>checkPostingAuthority({...policy,invoiceCents:1_300_000})).toThrow("Controller");
    expect(()=>checkPostingAuthority({...policy,invoiceLimit:NaN})).toThrow();
    expect(()=>checkPostingAuthority({...policy,accrualLimit:Infinity})).toThrow();
    for(const field of ["invoiceAccepted","evidenceVerified","periodOpen"] as const)expect(()=>checkPostingAuthority({...policy,[field]:false,controllerApproved:true})).toThrow();
  });
});
describe("protected posting integration (mocked Convex)",()=>{
  it("posts balanced reversal/AP once and atomically records authority/audit",async()=>{
    const {t,ids}=await preparedFinance(),proposalId=await t.mutation(internal.internal.ledger.createProposal,ids);
    expect(await t.mutation(internal.internal.ledger.createProposal,ids)).toBe(proposalId);
    const entryId=await t.mutation(internal.internal.ledger.postAuthorized,{proposalId});
    expect(await t.mutation(internal.internal.ledger.postAuthorized,{proposalId})).toBe(entryId);
    await t.run(async ctx=>{
      const entries=await ctx.db.query("journalEntries").withIndex("by_claim",q=>q.eq("claimId",ids.claimId)).collect();expect(entries).toHaveLength(3);expect(entries.map(e=>e.kind).sort()).toEqual(["ACCRUAL","ACCRUAL_REVERSAL","AP"]);
      const balances={VOYAGE_EXPENSE:0,ACCRUED_LIABILITY:0,ACCOUNTS_PAYABLE:0};
      for(const entry of entries){const lines=await ctx.db.query("journalLines").withIndex("by_entry",q=>q.eq("entryId",entry._id)).collect();validateJournal(lines);for(const line of lines)balances[line.accountCode]+=(line.side==="DEBIT"?1:-1)*line.amountCents;}
      expect(balances).toEqual({VOYAGE_EXPENSE:1_000_000,ACCRUED_LIABILITY:0,ACCOUNTS_PAYABLE:-1_000_000});
      expect((await ctx.db.get(ids.claimId))?.status).toBe("POSTED");
      const audits=await ctx.db.query("auditEvents").filter(q=>q.eq(q.field("eventType"),"JOURNAL_POSTED")).collect();expect(audits).toHaveLength(1);expect(audits[0].details.authority).toBe("STANDING_DELEGATION");
    });
  });
  it("F11 blocks a period locked after proposal without a partial posting",async()=>{
    const {t,ids}=await preparedFinance(),proposalId=await t.mutation(internal.internal.ledger.createProposal,ids);
    await t.run(ctx=>ctx.db.patch(ids.periodId,{status:"LOCKED"}));
    await expect(t.mutation(internal.internal.ledger.postAuthorized,{proposalId})).rejects.toThrow("locked");
    expect(await t.run(ctx=>ctx.db.query("journalEntries").withIndex("by_claim",q=>q.eq("claimId",ids.claimId)).collect())).toHaveLength(1);
  });
  it("F17 rejects an unrevised $30k invoice and stale/unsupported evidence",async()=>{
    const {t,ids}=await preparedFinance();
    await t.run(ctx=>ctx.db.patch(ids.invoiceId,{amountCents:3_000_000}));
    await expect(t.mutation(internal.internal.ledger.createProposal,ids)).rejects.toThrow("supported evidence");
    await t.run(async ctx=>{await ctx.db.patch(ids.invoiceId,{amountCents:1_000_000});const claim=await ctx.db.get(ids.claimId);await ctx.db.patch(ids.claimId,{evidenceIds:claim!.evidenceIds.slice(0,2)});});
    await expect(t.mutation(internal.internal.ledger.createProposal,ids)).rejects.toThrow("supported evidence");
  });
});

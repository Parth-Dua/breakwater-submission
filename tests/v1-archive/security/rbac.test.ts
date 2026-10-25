import { beforeEach,afterEach,describe,expect,it,vi } from "vitest";
import { api,internal } from "../../convex/_generated/api";
import { preparedFinance,testIdentity } from "../helpers/finance";
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());
describe("server-derived roles and proposal approval",()=>{
  it("denies Operations, Auditor, Admin and forged client roles without effects",async()=>{
    const {t,ids}=await preparedFinance();
    await t.run(async ctx=>{const delegation=await ctx.db.query("delegations").withIndex("by_action_status",q=>q.eq("actionType","POST_AP").eq("status","ACTIVE")).unique();await ctx.db.patch(delegation!._id,{maxAmountCents:500_000});});
    const proposalId=await t.mutation(internal.internal.ledger.createProposal,ids);
    for(const role of ["operations_reviewer","auditor","demo_admin"] as const){
      const {client,userId}=await testIdentity(t,role);
      await expect(client.mutation(api.finance.reviewProposal,{proposalId,decision:"APPROVE"})).rejects.toThrow("Permission denied");
      const spoofed=t.withIdentity({subject:userId,role:"finance_controller"});
      await expect(spoofed.mutation(api.finance.reviewProposal,{proposalId,decision:"APPROVE"})).rejects.toThrow("Permission denied");
      const attack={proposalId,decision:"APPROVE" as const,role:"finance_controller"};
      await expect(client.mutation(api.finance.reviewProposal,attack)).rejects.toThrow();
    }
    expect((await t.run(ctx=>ctx.db.get(proposalId)))?.status).toBe("REQUIRES_APPROVAL");
    expect(await t.run(ctx=>ctx.db.query("auditEvents").filter(q=>q.eq(q.field("eventType"),"FINANCIAL_PROPOSAL_APPROVED")).collect())).toHaveLength(0);
  });
  it("requires Controller approval above delegation and repeated approval has one effect",async()=>{
    const {t,ids}=await preparedFinance();
    await t.run(async ctx=>{const d=await ctx.db.query("delegations").withIndex("by_action_status",q=>q.eq("actionType","POST_AP").eq("status","ACTIVE")).unique();await ctx.db.patch(d!._id,{maxAmountCents:500_000});});
    const proposalId=await t.mutation(internal.internal.ledger.createProposal,ids);
    await expect(t.mutation(internal.internal.ledger.postAuthorized,{proposalId})).rejects.toThrow("Controller");
    const {client}=await testIdentity(t,"finance_controller");
    await client.mutation(api.finance.reviewProposal,{proposalId,decision:"APPROVE"});
    await client.mutation(api.finance.reviewProposal,{proposalId,decision:"APPROVE"});
    expect(await t.run(ctx=>ctx.db.query("auditEvents").filter(q=>q.eq(q.field("eventType"),"FINANCIAL_PROPOSAL_APPROVED")).collect())).toHaveLength(1);
    const entryId=await t.mutation(internal.internal.ledger.postAuthorized,{proposalId});
    expect((await t.run(ctx=>ctx.db.get(entryId)))?.authority).toContain("controller:");
  });
  it("denies unauthenticated and inactive access, including finance reads",async()=>{
    const {t}=await preparedFinance();
    await expect(t.query(api.finance.getClaimLedger,{})).rejects.toThrow("Authentication required");
    const {client}=await testIdentity(t,"finance_controller",false);
    await expect(client.query(api.finance.getClaimLedger,{})).rejects.toThrow("active workspace");
  });
});

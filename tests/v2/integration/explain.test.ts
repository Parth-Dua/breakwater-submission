import {afterEach,expect,test,vi} from "vitest";
import {api,internal} from "../../../convex/_generated/api";
import {agentWorld,setClaudeClient} from "../helpers/agentWorld";
import {scriptedClient,tool} from "../helpers/mockClaude";
import {canonicalJson} from "../../../src/domain/canonical";
import {scoreMetrics,type ScoreRow} from "../../../src/domain/score";
afterEach(()=>{setClaudeClient(null);vi.useRealTimers();});
async function source(){const t=await agentWorld({pdfs:false});await t.run(async ctx=>{const voyage=(await ctx.db.query("voyages").withIndex("by_ns",q=>q.eq("ns","demo")).first())!;await ctx.db.insert("cases",{ns:"demo",origin:"AUTOMATED_TEST",code:"WHY-TEST",voyageId:voyage._id,status:"WORKING",statusLine:"Working",openedAt:0,updatedAt:0,correlationId:"test:why"});const c=(await ctx.db.query("cases").withIndex("by_code",q=>q.eq("ns","demo").eq("code","WHY-TEST")).unique())!;await ctx.db.insert("facts",{ns:"demo",origin:"AUTOMATED_TEST",caseId:c._id,key:"COMPLETION",value:{at:1},evidence:[{kind:"CLAUSE",contractId:"actual-contract",clause:"8"}],establishedBy:"HUMAN",at:0});});return t;}

test("T-26: grounded citations only, low effort, immutable version cache and invalidation",async()=>{
 const t=await source(),client=scriptedClient([()=>[tool("explain_with_citations",{text:"The recorded contract governs this amount.",citationIds:["P1"]})],()=>[tool("explain_with_citations",{text:"The recorded contract governs this amount.",citationIds:["P1"]})]]);setClaudeClient(client);
 const args={entityType:"CASE_TOTAL" as const,entityId:"WHY-TEST",field:"PAYABLE"};const answer=await t.action(api.explain.why,args);expect(answer.citations).toHaveLength(1);expect(client.requests[0]).toMatchObject({output_config:{effort:"low"},tool_choice:{type:"auto"}});
 await t.action(api.explain.why,args);expect(client.requests).toHaveLength(1);
 await t.run(async ctx=>{const c=(await ctx.db.query("cases").withIndex("by_code",q=>q.eq("ns","demo").eq("code","WHY-TEST")).unique())!;await ctx.db.patch(c._id,{billedCents:100});});await t.action(api.explain.why,args);expect(client.requests).toHaveLength(2);
 const graph=await t.query(internal.explain.graph,{entityId:args.entityId,field:args.field}),cached=await t.query(internal.explain.evidence,{entityId:args.entityId,field:args.field});expect(cached).toHaveLength(2);expect(cached.every(row=>row.citations.every(ref=>graph.provenance.citations.some((allowed:unknown)=>canonicalJson(allowed)===canonicalJson(ref))))).toBe(true);
});

test("T-26: fabricated citation or number repairs once then safely caches deterministic fallback",async()=>{
 const t=await source(),client=scriptedClient([()=>[tool("explain_with_citations",{text:"Pay $999,999.",citationIds:["INVENTED"]})],()=>[tool("explain_with_citations",{text:"Pay $999,999.",citationIds:["P1"]})]]);setClaudeClient(client);
 const args={entityType:"CASE_TOTAL" as const,entityId:"WHY-TEST",field:"PAYABLE"};const answer=await t.action(api.explain.why,args);expect(answer.text).not.toContain("999,999");expect(client.requests).toHaveLength(2);expect((await t.query(internal.explain.evidence,{entityId:args.entityId,field:args.field}))[0]).toMatchObject({model:"deterministic",usage:{tokensIn:200,tokensOut:40}});
 await t.action(api.explain.why,args);expect(client.requests).toHaveLength(2);
});

test("Score metrics distinguish exact cents, missing/extra asks, disputed lines, materiality and failed real tasks",()=>{
 const expected={payableCents:1200,recoverableCents:900,disputeLines:["SHIFTING"],asks:[{role:"controller",kind:"PAYMENT_APPROVAL"}],belowMaterialityCents:150};
 const actual={payableCents:1200,recoverableCents:900,disputeLines:["SHIFTING","CURRENCY"],asks:[{role:"controller",kind:"PAYMENT_APPROVAL"},{role:"ops",kind:"CONFIRM_FACT"}],acceptedFeeCents:150,controlViolations:0,tokensIn:500,tokensOut:100,models:["actual"],errors:[]};
 const rows:ScoreRow[]=[{code:"one",vessel:"one",state:"COMPLETE",expected,actual,wallMs:1000},{code:"two",vessel:"two",state:"REVIEW",expected:{...expected,disputeLines:[],asks:[],belowMaterialityCents:0},actual:{...actual,payableCents:1199,disputeLines:[],asks:[],errors:["Timeout"]},wallMs:2000}];
 expect(scoreMetrics(rows)).toMatchObject({statementExactness:.5,disputePrecision:.5,disputeRecall:1,askPrecision:.5,askRecall:1,unnecessaryAsks:1,materialityHandling:1,controlViolations:0,tokensIn:1000,tokensOut:200,wallMs:3000,failures:1});
});

import {afterEach,expect,test,vi} from "vitest";
import {internal} from "../../../convex/_generated/api";
import {testBackend} from "../helpers/convex";
import {setClaudeClient} from "../helpers/agentWorld";
import {scriptedClient,tool,json,text} from "../helpers/mockClaude";
import manifest from "../../../fixtures/documents/manifest.json";
import scoreboard from "../../../fixtures/world/scoreboard.json";
import {aisWindow,caseContextForVoyage,getDocument} from "../../../convex/sources/read";
import {baseAgentCapabilities} from "../../../src/domain/capabilities";
afterEach(()=>{setClaudeClient(null);vi.useRealTimers();});

test("Duplicate-invoice plants contain a second source invoice, with unchanged amount and a distinct invoice number",()=>{
 const planted=scoreboard.voyages.filter(item=>item.plants.includes("DUPLICATE_INVOICE"));expect(planted).toHaveLength(2);
 for(const item of planted){const invoices=item.documents.filter(doc=>doc.kind==="OWNER_INVOICE");expect(invoices).toHaveLength(2);const primary=invoices[0].data as {invoiceNo:string;totalCents:number},duplicate=invoices[1].data as {invoiceNo:string;totalCents:number;duplicateOf:string};expect(duplicate.invoiceNo).not.toBe(primary.invoiceNo);expect(duplicate.duplicateOf).toBe(primary.invoiceNo);expect(duplicate.totalCents).toBe(primary.totalCents);expect(invoices[1].receivedAt).toBeGreaterThan(invoices[0].receivedAt);}
});

test("Score harness runs the ordinary agent on actual source PDFs, exposes no answer key, and isolates overlapping voyages without resetting data",async()=>{
 vi.useFakeTimers();const t=testBackend();await t.action(internal.world.import.importAll,{ns:"score"});
 const entries=manifest.filter(doc=>doc.ns==="score");const items=await t.run(async ctx=>Promise.all(entries.map(async doc=>({code:doc.code,storageId:await ctx.storage.store(new Blob([doc.code]))}))));for(let i=0;i<items.length;i+=25)await t.mutation(internal.world.importDocuments.register,{ns:"score",items:items.slice(i,i+25)});
 const runId=await t.mutation(internal.score.start,{model:"claude-sonnet-5-5"}),item=scoreboard.voyages[0];
 const source=(item:typeof scoreboard.voyages[number])=>({caseCode:item.caseCode,voyageCode:item.voyage.code,openedAt:item.openedAt,ais:item.ais,customs:item.customs,documentCodes:item.documents.map(doc=>doc.code)});
 const caseCode=await t.mutation(internal.score.stage,{runId,source:source(item)});expect(await t.mutation(internal.score.stage,{runId,source:source(item)})).toBe(caseCode);
 const nor=item.documents.find(doc=>doc.kind==="NOR")!,data=nor.data as {tenderedText:string;location:string;vessel:string};
 const taskId=await t.mutation(internal.score.document,{caseCode,documentCode:nor.code});expect(await t.mutation(internal.score.document,{caseCode,documentCode:nor.code})).toBe(taskId);
 const client=scriptedClient([()=>[tool("read_document",{caseCode,documentCode:nor.code})],()=>[json({tenderedAt:{value:new Date(item.nor.tenderedAt).toISOString(),quote:data.tenderedText},statedLocation:{value:data.location,quote:data.location},vesselName:{value:data.vessel,quote:data.vessel},ignoredInstructions:[]})],()=>[tool("check_nor",{caseCode,documentCode:nor.code})],()=>[text("Checked.")]]);setClaudeClient(client);
 await t.action(internal.node.agent.runTask,{taskId});const observed=await t.query(internal.score.inspect,{caseCode});expect(observed.tasks).toHaveLength(1);expect(observed.tasks[0]).toMatchObject({state:"SUCCEEDED",model:"claude-sonnet-5-5"});expect(JSON.stringify(client.requests)).not.toMatch(/answerKey|expectedAsks|PREMATURE_NOR/);
 await t.run(async ctx=>{const c=(await ctx.db.query("cases").withIndex("by_code",q=>q.eq("ns","score").eq("code",caseCode)).unique())!;await ctx.db.patch(c._id,{reconciliation:{payableCents:100,variances:[{kind:"CURRENCY",cents:0},{kind:"SHIFTING",cents:500}]}});});expect((await t.query(internal.score.inspect,{caseCode})).actual.disputeLines).toEqual(["SHIFTING"]);
 const other=scoreboard.voyages.find(v=>v.voyage.vesselCode===item.voyage.vesselCode&&v.caseCode!==item.caseCode)!;await t.mutation(internal.score.stage,{runId,source:source(other)});
 await t.run(async ctx=>{const voyage=(await ctx.db.query("voyages").withIndex("by_code",q=>q.eq("ns","score").eq("code",item.voyage.code)).unique())!,context=await caseContextForVoyage(ctx,voyage._id,Date.UTC(2027,0,1)),scope={ns:"score",context,capabilities:baseAgentCapabilities(),simNow:Date.UTC(2027,0,1)};
 const track=await aisWindow(ctx,scope,{vesselId:voyage.vesselId,from:0,to:Date.UTC(2027,0,1)});expect(track.points).toEqual(item.ais);await expect(getDocument(ctx,scope,other.documents.find(doc=>doc.kind==="NOR")!.code)).rejects.toThrow(/another voyage/);expect((await ctx.db.query("cases").withIndex("by_ns",q=>q.eq("ns","score")).collect())).toHaveLength(2);
 });
},120_000);

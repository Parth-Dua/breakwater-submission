import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { api, internal } from "../../../convex/_generated/api";
import manifest from "../../../fixtures/documents/manifest.json";
import { agentWorld, replayClient, setClaudeClient, runQueued, attach, releaseNext, type T, type Transcript } from "../helpers/agentWorld";
import { prepareStory } from "../helpers/stories";
import { anonymousIdentity } from "../helpers/convex";
import { scriptedClient, text, tool } from "../helpers/mockClaude";
import { capabilitiesFor, activeOverrides, currentFacts, intervalFacts, loadCase } from "../../../convex/agent/state";
import { computeStatement, type IntervalInput } from "../../../src/domain/laytime";
import { JevClassifier } from "../../../convex/node/classifier/jev";
import type { ClassifierResult, Procedure } from "../../../src/domain/learning-types";

// Test-only Jev responses exercise approval paths; they are not service accuracy evidence.
beforeEach(() => {
  vi.stubEnv("BREAKWATER_JEV_TRANSPORT", "typesafe"); vi.stubEnv("TYPESAFE_API_KEY", "contract-test-only");
  vi.spyOn(JevClassifier.prototype, "classify").mockImplementation(async lesson => {
    const type = lesson.proposed_payload.type;
    const kind = type === "PROCEDURE" ? "PROCEDURE" : type === "PRECEDENT" ? "PRECEDENT" : "FACT";
    const scope = kind === "PROCEDURE" ? "ALL" : kind === "PRECEDENT" ? "THIS_CASE" : "CHARTER_FORM";
    return { provider: "jev", model: "contract-test", kind: { choice: kind, confidence: .9, probabilities: { [kind]: .9 } }, scope: { choice: scope, confidence: .9, probabilities: { [scope]: .9 } }, discretionary: { noul: kind === "PRECEDENT" ? .9 : .1 } } satisfies ClassifierResult;
  });
});
const auto = { automation: true }, kestrel = "DC-2026-0398";
const procedure: Procedure = { dslVersion: 2, trigger: { intervalKind: "CUSTOMS_HOLD", missingEvidence: "CUSTOMS_RELEASE", ports: "ALL" }, grants: [{ system: "CUSTOMS_PORTAL", scope: "CASE_VESSEL_AND_INTERVAL" }], steps: [{ op: "SEARCH_SOURCE", system: "CUSTOMS_PORTAL", match: { vessel: true, interval: true } }, { op: "VERIFY_DOCUMENT", checks: ["SAME_VESSEL","COVERS_INTERVAL","ISSUER_IS_AUTHORITY"] }, { op: "MARK_VERIFIED" }, { op: "ESCALATE_IF_MISSING", role: "ops" }] };
async function as(t: T, code: "OPS" | "CONTROLLER" | "TRADER") { const { identity } = await anonymousIdentity(t), user = t.withIdentity(identity); await user.mutation(api.session.setActingAs, { code }); return user; }
async function prepared() {
  const t = await agentWorld({ pdfs: false });
  const historyDocs = manifest.filter(item => item.ns === "demo" && item.caseCode);
  const items = await t.run(async ctx => Promise.all(historyDocs.map(async doc => ({ code: doc.code, storageId: await ctx.storage.store(new Blob([doc.code])) }))));
  for (let i = 0; i < items.length; i += 25) await t.mutation(internal.world.importDocuments.register, { ns: "demo", items: items.slice(i,i+25) });
  const replay = replayClient(JSON.parse(readFileSync("fixtures/agent-transcripts/prepare.json","utf8")) as Transcript); setClaudeClient(replay); await prepareStory(t); setClaudeClient(null);
  return t;
}
async function opsAnswer(t: T) {
  const ops = await as(t,"OPS");
  await ops.mutation(api.sources.search, { caseCode: kestrel, system: "CUSTOMS_PORTAL", query: "Kestrel", ...auto });
  await ops.mutation(api.sources.openDocument, { caseCode: kestrel, documentCode: "DOC-SSZ-CUSTOMS-RELEASE-1004", ...auto });
  const evidence = { kind: "DOC" as const, documentId: "DOC-SSZ-CUSTOMS-RELEASE-1004" };
  await ops.mutation(api.asks.linkEvidence, { askCode: "K-1", evidence, ...auto });
  await ops.mutation(api.asks.answer, { askCode: "K-1", answer: { optionId: "CONFIRM", evidence: [evidence] }, ...auto });
  const ask = await t.run(ctx => ctx.db.query("asks").withIndex("by_code", q => q.eq("ns","demo").eq("code","K-1")).unique()); return ask!;
}
async function procedureReady() {
  const t = await prepared(), ask = await opsAnswer(t);
  const draft = scriptedClient([() => [tool("draft_lesson", { lesson_text: "Check the customs portal before asking Ops", proposed_payload: { type: "PROCEDURE", procedure } })]]);
  setClaudeClient(draft); await t.action(internal.learning.processAnswer, { askId: ask._id });
  const item = await t.run(async ctx => (await ctx.db.query("memoryItems").withIndex("by_ns",q=>q.eq("ns","demo")).collect()).find(item => item.sourceAskId === ask._id));
  expect(item).toMatchObject({ code: "P-CUSTOMS-PORTAL-FIRST", status: "PENDING_TEACHBACK", origin: "AUTOMATED_TEST" });
  expect(draft.requests).toHaveLength(1); expect(draft.requests[0]).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "high" }, tool_choice: { type: "auto" } });
  await t.action(internal.learning.processAnswer, { askId: ask._id }); expect(draft.requests).toHaveLength(1);
  const ops = await as(t,"OPS"), teach = await t.run(async ctx => (await ctx.db.query("asks").withIndex("by_ns",q=>q.eq("ns","demo")).collect()).find(ask=>ask.kind==="TEACH_BACK"&&ask.status==="OPEN"));
  await ops.mutation(api.asks.answer, { askCode: teach!.code, answer: { optionId: "ALL" }, ...auto });
  const pending = await t.run(ctx=>ctx.db.get(item!._id)); expect(pending?.status).toBe("PENDING_CONTROLLER");
  const backtest = await t.run(ctx=>ctx.db.get(pending!.backtestId!)); expect(backtest).toMatchObject({ consistent: 6, total: 6 });
  await expect(ops.mutation(api.memory.decide, { memoryCode: item!.code, decision: "APPROVE", ...auto })).rejects.toThrow(/WRONG_ROLE/);
  const controller = await as(t,"CONTROLLER"); await controller.mutation(api.memory.decide, { memoryCode: item!.code, decision: "APPROVE", ...auto });
  expect((await t.run(ctx=>ctx.db.get(item!._id)))?.status).toBe("ACTIVE");
  setClaudeClient(scriptedClient([() => [tool("compute_statement", { caseCode: "x", side: "RECOVERABLE" })], () => [tool("file_recovery", { caseCode: "x" })], () => [text("Done.")]])); await runQueued(t); setClaudeClient(null);
  return { t, procedureId: item!._id, sourceAskId: ask._id };
}
afterEach(()=>{ setClaudeClient(null); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

test("Lesson repairs retain the usage and served models of every observed response", async()=>{
  const { testBackend } = await import("../helpers/convex"), t = testBackend();
  const client = scriptedClient([
    () => [tool("draft_lesson", { lesson_text: "Invalid access", proposed_payload: { type: "PROCEDURE", procedure: { ...procedure, code: "execute()" } } })],
    () => [tool("draft_lesson", { lesson_text: "Check the customs portal", proposed_payload: { type: "PROCEDURE", procedure } })],
  ]); setClaudeClient(client);
  const result = await t.action(internal.node.lessons.build, { context: { caseCode:"any", role:"ops", formCode:"any", portCode:"BRSSZ", counterpartyCode:"any", history:{corroborating:0,contradicting:0}, amountAtRiskCents:0, diff:{type:"MISSING_SOURCE",agentSide:{},humanSide:{system:"CUSTOMS_PORTAL",documentKind:"CUSTOMS_RELEASE"},provenanceEventIds:[],ignoredEventIds:[],humanEvidence:false} }, deadlineAt:Date.now()+240_000 });
  expect(result).toMatchObject({ model:"claude-sonnet-5-5", usage:{ tokensIn:200,tokensOut:40,observedResponses:2 }, draft:{lesson_text:"Check the customs portal"} });
  expect(client.requests).toHaveLength(2);
  const schema = client.requests[0].tools?.[0] as { input_schema: unknown };
  expect(JSON.stringify(schema.input_schema)).not.toMatch(/"(?:maxLength|maxItems)"|"minItems":2/);
});

test("A failed draft can be explicitly retried without replaying money or erasing its failed classifier record",async()=>{
  const t=await prepared(),ask=await opsAnswer(t);
  setClaudeClient(scriptedClient([()=>new Error("Transport failed"),()=>new Error("Transport failed"),()=>new Error("Transport failed")]));
  await t.action(internal.learning.processAnswer,{askId:ask._id});
  expect((await t.query(internal.learning.evidence,{since:0})).jobs[0].state).toBe("NEEDS_REVIEW");
  // Freeze the scheduled recovery copy; invoke the pipeline explicitly in this driver.
  vi.useFakeTimers();await t.mutation(internal.learning.retryUnavailable,{askCode:ask.code});
  setClaudeClient(scriptedClient([()=>[tool("draft_lesson",{lesson_text:"Check the customs portal",proposed_payload:{type:"PROCEDURE",procedure}})]]));
  await t.action(internal.learning.processAnswer,{askId:ask._id});vi.useRealTimers();
  const proof=await t.query(internal.learning.evidence,{since:0});
  expect(proof.jobs[0].state).toBe("COMPLETE");expect(proof.lessons).toHaveLength(1);
  expect(proof.lessons[0].classifier.map((call:{status:string})=>call.status)).toEqual(["ERROR","OK"]);
  expect(proof.memories.find((item:{code:string})=>item.code==="P-CUSTOMS-PORTAL-FIRST")?.status).toBe("PENDING_TEACHBACK");
  await expect(t.mutation(internal.learning.retryUnavailable,{askCode:ask.code})).rejects.toThrow(/Only a failed/);
},120_000);

test("T-17/L-07: semantic Ops provenance produces a classifier-backed procedure, 6/6 persisted-source backtest, explicit Controller approval and one idempotent job", async()=>{
  const { t, procedureId, sourceAskId } = await procedureReady();
  expect(await t.query(api.room.money,{caseCode:kestrel})).toMatchObject({recoverCents:2_700_000,recoveryState:"filed"});
  const state = await t.run(async ctx=>({item:await ctx.db.get(procedureId),jobs:await ctx.db.query("learningRuns").withIndex("by_ns",q=>q.eq("ns","demo")).collect(),diffs:await ctx.db.query("traceDiffs").withIndex("by_ask",q=>q.eq("ns","demo").eq("askId",sourceAskId)).collect(),calls:await ctx.db.query("classifierCalls").withIndex("by_ns",q=>q.eq("ns","demo")).collect()}));
  expect(state.jobs).toHaveLength(1); expect(state.jobs[0].state).toBe("COMPLETE"); expect(state.diffs).toHaveLength(1); expect(state.diffs[0].type).toBe("MISSING_SOURCE"); expect(state.calls).toHaveLength(1); expect(state.calls[0]).toMatchObject({provider:"jev",status:"OK"});
  const detail = await t.query(api.memory.detail,{memoryCode:state.item!.code}); expect(detail).toMatchObject({classifierLabel:"Jev contract-test",automated:true,approvedBy:"Automated test"});
},120_000);

test("T-08/T-19/L-08: learned procedure is used without Ops; Trader deviation stays precedent; Controller correction activates only after teach-back; revocation removes the capability", async()=>{
  const {t,procedureId}=await procedureReady();
  const replay=replayClient(JSON.parse(readFileSync("fixtures/agent-transcripts/storm.json","utf8")) as Transcript); setClaudeClient(replay); await attach(t,"RTM-STORM-2026-10");
  let controllerAskCode="";
  for(let i=0;i<40;i++){
    if(!await releaseNext(t)) break; await runQueued(t);
    const asks=await t.run(ctx=>ctx.db.query("asks").withIndex("by_ns",q=>q.eq("ns","demo")).collect());
    const traderAsk=asks.find(a=>a.kind==="COMMERCIAL_DECISION"&&a.status==="OPEN");
    if(traderAsk){const trader=await as(t,"TRADER"); await trader.mutation(api.asks.answer,{askCode:traderAsk.code,answer:{optionId:"PARTIAL",amountCents:9_060_000,reason:"Goodwill: late Q3 cargo"},...auto}); await runQueued(t);
      setClaudeClient(scriptedClient([()=>[tool("draft_lesson",{lesson_text:"Commercial goodwill waiver",proposed_payload:{type:"PRECEDENT",summary:"Goodwill for the late Q3 cargo",counterpartyCode:"HANSA",amountCents:300_000}})]])); await t.action(internal.learning.processAnswer,{askId:traderAsk._id}); setClaudeClient(replay);
    }
    const payment=asks.find(a=>a.kind==="PAYMENT_APPROVAL"&&a.status==="OPEN"); if(payment){controllerAskCode=payment.code;break;}
  }
  expect(controllerAskCode).toBe("A-2");
  const aster=await t.run(ctx=>ctx.db.query("cases").withIndex("by_code",q=>q.eq("ns","demo").eq("code","DC-2026-0412")).unique());
  const asks=await t.run(ctx=>ctx.db.query("asks").withIndex("by_case",q=>q.eq("ns","demo").eq("caseId",aster!._id)).collect()); expect(asks.some(a=>a.role==="ops")).toBe(false);
  const steps=await t.run(ctx=>ctx.db.query("agentSteps").withIndex("by_case_seq",q=>q.eq("ns","demo").eq("caseId",aster!._id)).collect()); expect(steps.some(step=>step.memoryRefs.includes("P-CUSTOMS-PORTAL-FIRST"))).toBe(true);
  const precedent=await t.run(async ctx=>(await ctx.db.query("memoryItems").withIndex("by_ns",q=>q.eq("ns","demo")).collect()).find(item=>item.sourceCaseId===aster!._id&&item.kind==="PRECEDENT")); expect(precedent?.status).toBe("PRECEDENT_ONLY");
  const controller=await as(t,"CONTROLLER"), preview=(await controller.query(api.statements.preview,{askCode:controllerAskCode}))!, closure=preview.lines.find(line=>line.kind==="PORT_CLOSURE")!;
  await controller.mutation(api.statements.editLine,{askCode:controllerAskCode,lineId:closure.id,field:"treatment",to:"COUNT",basis:{clause:"8",note:"CP cl. 8 proviso: already on demurrage"},expectedVersion:preview.version,...auto});
  const edited=(await controller.query(api.statements.preview,{askCode:controllerAskCode}))!; await controller.mutation(api.asks.answer,{askCode:controllerAskCode,answer:{optionId:"APPROVE",editIds:edited.editIds},expectedVersion:edited.version,...auto});
  const invoiceCode=(aster!.reconciliation as {invoiceCode:string}).invoiceCode;
  setClaudeClient(scriptedClient([()=>[tool("compute_statement",{caseCode:"x",side:"PAYABLE"})],()=>[tool("reconcile_invoice",{caseCode:"x",documentCode:invoiceCode})],()=>[tool("post_ap",{caseCode:"x"})],()=>[text("Done.")]])); await runQueued(t);
  const sourceAsk=asks.find(a=>a.code===controllerAskCode)!;
  setClaudeClient(scriptedClient([()=>[tool("draft_lesson",{lesson_text:"Closures count in full once on demurrage",proposed_payload:{type:"CONTRACT_RULE_OVERRIDE",formCode:"NORDHAVN-CP-2019",clause:"8",rule:"EXCEPTIONS_APPLY_ON_DEMURRAGE",value:false}})]])); await t.action(internal.learning.processAnswer,{askId:sourceAsk._id});
  const fact=await t.run(async ctx=>(await ctx.db.query("memoryItems").withIndex("by_ns",q=>q.eq("ns","demo")).collect()).find(item=>item.sourceAskId===sourceAsk._id)); expect(fact?.status).toBe("PENDING_TEACHBACK");
  const lesson=await t.run(ctx=>ctx.db.get(fact!.lessonId!)); expect((lesson!.lessonJson as {history:unknown}).history).toEqual({corroborating:2,contradicting:0});
  await controller.mutation(api.session.setActingAs,{code:"CONTROLLER"}); const teach=await t.run(async ctx=>(await ctx.db.query("asks").withIndex("by_case",q=>q.eq("ns","demo").eq("caseId",aster!._id)).collect()).find(a=>a.kind==="TEACH_BACK"&&a.status==="OPEN"));
  await controller.mutation(api.asks.answer,{askCode:teach!.code,answer:{optionId:"CHARTER_FORM"},...auto}); expect((await t.run(ctx=>ctx.db.get(fact!._id)))?.status).toBe("ACTIVE");
  await t.run(async ctx=>{const b=await loadCase(ctx,aster!._id),facts=await currentFacts(ctx,"demo",aster!._id), statement=(await ctx.db.query("statements").withIndex("by_case_side_version",q=>q.eq("ns","demo").eq("caseId",aster!._id).eq("side","PAYABLE")).collect()).at(-1)!; const result=computeStatement({side:"PAYABLE",terms:b.charter.terms,formCode:b.charter.formCode,contractId:b.charter.code,laytimeStartAt:statement.laytimeStartAt,completionAt:statement.completionAt,intervals:intervalFacts(facts).map(interval=>({kind:interval.kind as IntervalInput["kind"],startAt:interval.startAt,endAt:interval.endAt,verified:interval.verified,evidence:[]})),fees:[],edits:[],overrides:await activeOverrides(ctx,"demo",b.charter.formCode)}); expect(result.totals.totalCents).toBe(12_200_000); expect(result.memoryItemIds).toContain(fact!.code);});
  const laterCase=await t.run(async ctx=>{const id=await ctx.db.insert("cases",{ns:"demo",origin:"AUTOMATED_TEST",code:"TEST-REVOKE",voyageId:aster!.voyageId,status:"OPEN",openedAt:aster!.openedAt,statusLine:"Test",correlationId:"test-revoke",updatedAt:0});await ctx.db.insert("facts",{ns:"demo",origin:"AUTOMATED_TEST",caseId:id,key:"INTERVAL",value:{kind:"CUSTOMS_HOLD",startAt:Date.UTC(2026,9,30,12),endAt:Date.UTC(2026,9,31,18),verified:false},evidence:[],establishedBy:"AGENT",at:0});return id;});
  expect((await t.run(ctx=>capabilitiesFor(ctx,"demo",laterCase))).capabilities.some(cap=>cap.system==="CUSTOMS_PORTAL")).toBe(true);
  await controller.mutation(api.session.setActingAs,{code:"CONTROLLER"}); await controller.mutation(api.memory.revoke,{memoryCode:"P-CUSTOMS-PORTAL-FIRST",reason:"Retest revocation",...auto});
  expect((await t.run(ctx=>capabilitiesFor(ctx,"demo",laterCase))).capabilities.some(cap=>cap.system==="CUSTOMS_PORTAL")).toBe(false); expect((await t.run(ctx=>ctx.db.get(procedureId)))!.usedIn).toContain(aster!._id);
  await t.run(ctx=>ctx.db.patch(precedent!._id,{status:"ACTIVE"})); expect((await t.run(ctx=>capabilitiesFor(ctx,"demo",laterCase))).capabilities.some(cap=>cap.system==="CUSTOMS_PORTAL")).toBe(false); expect((await t.run(ctx=>activeOverrides(ctx,"demo","NORDHAVN-CP-2019")))).toHaveLength(1);
},180_000);

test("T-23: configured Jev without a key stays unavailable, persists ERROR and cannot activate a procedure", async()=>{
  const t=await prepared(),ask=await opsAnswer(t); vi.stubEnv("TYPESAFE_API_KEY","");
  setClaudeClient(scriptedClient([()=>[tool("draft_lesson",{lesson_text:"Check the customs portal before asking Ops",proposed_payload:{type:"PROCEDURE",procedure}})]]));await t.action(internal.learning.processAnswer,{askId:ask._id});
  const calls=await t.run(ctx=>ctx.db.query("classifierCalls").withIndex("by_ns",q=>q.eq("ns","demo")).collect());expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({provider:"jev",status:"ERROR",error:"CLASSIFIER_UNAVAILABLE"});
  const item=await t.run(async ctx=>(await ctx.db.query("memoryItems").withIndex("by_ns",q=>q.eq("ns","demo")).collect()).find(item=>item.sourceAskId===ask._id));expect(item?.status).toBe("NEEDS_REVIEW");
  const controller=await as(t,"CONTROLLER");await expect(controller.mutation(api.memory.decide,{memoryCode:item!.code,decision:"APPROVE",reason:"No bypass",...auto})).rejects.toThrow(/successful classifier/);
},120_000);

test("L-06/activation guard: an incomplete seeded candidate cannot activate; Just this case remains non-executable", async()=>{
  const t=await prepared(),controller=await as(t,"CONTROLLER");
  const ids=await t.run(async ctx=>{
    const c=(await ctx.db.query("cases").withIndex("by_code",q=>q.eq("ns","demo").eq("code",kestrel)).unique())!,persona=(await ctx.db.query("personas").withIndex("by_code",q=>q.eq("ns","demo").eq("code","CONTROLLER")).unique())!;
    const source=await ctx.db.insert("asks",{ns:"demo",origin:"AUTOMATED_TEST",code:"TEST-SOURCE",caseId:c._id,kind:"PAYMENT_APPROVAL",role:"controller",question:"Unit source",subject:"PAYMENT",options:[],context:{evidence:[]},gatesClock:false,status:"ANSWERED",answer:{optionId:"APPROVE"},answeredBy:persona._id,answeredAt:0,createdAt:0,remindersSent:0});
    const memoryId=await ctx.db.insert("memoryItems",{ns:"demo",origin:"AUTOMATED_TEST",code:"TEST-CANDIDATE",kind:"FACT",status:"PENDING_TEACHBACK",title:"Unit incomplete candidate",payload:{type:"CONTRACT_RULE_OVERRIDE",formCode:"THALASSA-CP-2021",clause:"8",rule:"EXCEPTIONS_APPLY_ON_DEMURRAGE",value:false},scope:{kind:"CHARTER_FORM",value:"THALASSA-CP-2021"},sourceCaseId:c._id,sourceAskId:source,sourcePersonaId:persona._id,version:1,usedIn:[],createdAt:0});
    await ctx.db.insert("asks",{ns:"demo",origin:"AUTOMATED_TEST",code:"TEST-TEACH",caseId:c._id,kind:"TEACH_BACK",role:"controller",question:"Next time?",subject:"TEST-CANDIDATE",options:[{id:"CHARTER_FORM",label:"All voyages"},{id:"THIS_CASE",label:"Just this case"}],context:{evidence:[]},gatesClock:false,status:"OPEN",createdAt:0,remindersSent:0}); return {memoryId};
  });
  await expect(controller.mutation(api.asks.answer,{askCode:"TEST-TEACH",answer:{optionId:"CHARTER_FORM"},...auto})).rejects.toThrow(/classifier result/);
  await controller.mutation(api.asks.answer,{askCode:"TEST-TEACH",answer:{optionId:"THIS_CASE"},...auto});
  const item=await t.run(ctx=>ctx.db.get(ids.memoryId));expect(item).toMatchObject({kind:"PRECEDENT",status:"PRECEDENT_ONLY",payload:{type:"PRECEDENT"}});
  expect(await t.run(ctx=>activeOverrides(ctx,"demo","THALASSA-CP-2021"))).toEqual([]);
},120_000);

test("L-10: calibration persists Jev responses and computes accuracy from per-item results", async()=>{
  const {testBackend}=await import("../helpers/convex"),t=testBackend();
  const result=await t.action(internal.node.classifier.calibrate.run,{});
  expect(result).toMatchObject({provider:"jev",model:"contract-test",total:40});
  const overview=await t.query(api.learning.calibration,{});
  expect(overview.jev).toMatchObject({total:40,correct:result.correct});
  expect(JSON.stringify(overview)).not.toContain('"_id"');
});

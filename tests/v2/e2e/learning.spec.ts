import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { learningHashes, LEARNING_REPORT, savedLearningEvidence } from "../../../scripts/live/learning-evidence";

function convex(name:string,args:object) { const r=spawnSync("npx",["convex","run",name,JSON.stringify(args)],{encoding:"utf8"}); expect(r.status,r.stderr.slice(-1200)).toBe(0);return JSON.parse(r.stdout.trim()||"null"); }
const restore=()=>convex("demo:restore",{label:"baseline",actor:"system:AUTOMATED_TEST:V10"});
const evidence=(since:number)=>convex("learning:evidence",{since});
async function role(page:Page,code:string) { await expect(page.getByTestId("acting-as")).toBeEnabled();await page.getByTestId("acting-as").selectOption(code); await expect(page.getByTestId("acting-as")).toHaveValue(code); }
async function shot(page:Page,name:string) { await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));}); await page.screenshot({animations:"disabled",path:`artifacts/v2/V10/${name}.png`}); }

test("V10 static: Proof keeps internal classifier details out of the desk",async({page})=>{
  test.skip(Number(process.env.BREAKWATER_GATE_PHASE?.slice(1)??0)<10,"V10");
  await page.goto("/");await page.getByRole("tab",{name:"Proof",exact:true}).click();
  await expect(page.getByTestId("proof-view")).not.toContainText(/jev|classifier|calibration/i);
});

test("V10 live U-20/T-08: learn procedure, use it, keep waiver as precedent, activate Controller fact",async({page})=>{
  test.skip(Number(process.env.BREAKWATER_GATE_PHASE?.slice(1)??0)>=11,"Accepted V10 live evidence retained; V11 gate validates current score/provenance/UI changes without repeating the full demo");
  test.skip(Number(process.env.BREAKWATER_GATE_PHASE?.slice(1)??0)<10,"V10");
  test.skip(process.env.BREAKWATER_REUSE_LIVE==="1"&&!!savedLearningEvidence(),"Source-bound V10 live evidence already verified; gate validates the persisted report");
  test.setTimeout(780_000);mkdirSync("artifacts/v2/V10",{recursive:true});const resuming=process.env.BREAKWATER_RESUME_LEARNING==="1";if(!resuming)restore();const since=resuming?JSON.parse(readFileSync("artifacts/v2/V10/live-incomplete.json","utf8")).since:Date.now();
  // On failure preserve the actual run for diagnosis/resumption, avoiding repeated API spend.
  try {
    await page.route("https://tiles.openfreemap.org/**",r=>r.abort());
    await page.goto("/case/DC-2026-0398");
    if(!resuming) { await role(page,"OPS");
    await page.getByRole("button",{name:"Customs portal",exact:true}).click();await page.getByRole("button",{name:"Search",exact:true}).click();
    await page.getByTestId("ops-desk").getByRole("button",{name:/Customs release 1004/}).click();
    await expect(page.getByTestId("document-viewer")).toBeVisible();await page.getByRole("button",{name:"Link to hold",exact:true}).click();
    await expect(page.getByRole("button",{name:"Linked",exact:true})).toBeDisabled();await page.getByRole("button",{name:"Submit",exact:true}).click();
    await expect(page.getByTestId("acting-as")).toHaveValue("OBSERVER"); }
    await expect.poll(()=>convex("room:money",{caseCode:"DC-2026-0398"}).recoveryState,{timeout:120_000}).toBe("filed");
    await expect.poll(()=>evidence(since).memories.some((m:{kind:string;status:string})=>m.kind==="PROCEDURE"&&m.status==="PENDING_TEACHBACK"),{timeout:120_000}).toBe(true);
    await role(page,"OPS");await expect(page.getByRole("region",{name:"Teach back"})).toBeVisible();
    await shot(page,"procedure-teachback");await page.getByRole("button",{name:"All ports",exact:true}).click();
    const procedure=page.locator('[data-memory-code="P-CUSTOMS-PORTAL-FIRST"]');
    await expect(procedure).toBeVisible();await expect(procedure).toHaveAttribute("data-status","PENDING_CONTROLLER");await expect(procedure).toContainText("NEW");
    await procedure.getByRole("button").first().click();await expect(procedure).toContainText("6/6 consistent");
    await role(page,"CONTROLLER");await shot(page,"procedure-controller");await procedure.getByRole("button",{name:"Approve",exact:true}).click();
    await expect(procedure).toHaveAttribute("data-status","ACTIVE");await expect(page.getByTestId("acting-as")).toHaveValue("OBSERVER");
    await shot(page,"procedure-active");
    const ops=convex("work:evidence",{since});expect(ops.events.every((e:{origin:string})=>e.origin==="AUTOMATED_TEST")).toBe(true);
    await page.goto("/");await page.getByRole("button",{name:"New disruption",exact:true}).click();
    const row=page.locator('[data-vessel="Aster Vale"]');await expect(row).toBeVisible({timeout:5000});await expect(row).toHaveAttribute("aria-busy","true");
    const initial=await row.getByTestId("case-status").innerText();await expect.poll(()=>row.getByTestId("case-status").innerText(),{timeout:45_000}).not.toBe(initial);
    await expect(row).toHaveAttribute("data-case","DC-2026-0412",{timeout:45_000});await page.goto("/case/DC-2026-0412");
    await expect(page.getByTestId("now-card")).toBeVisible({timeout:45_000});await expect(page.getByTestId("nor-distance")).toHaveText("24.0 nm",{timeout:120_000});await shot(page,"nor-catch");
    await expect(page.getByRole("button",{name:"Used memory",exact:true}).first()).toBeVisible({timeout:120_000});
    await page.getByRole("button",{name:"Used memory",exact:true}).first().click();await expect(procedure).toBeVisible();await expect(procedure).toContainText("Aster Vale");await shot(page,"procedure-used");
    await expect(page.getByRole("button",{name:"Answer as Trader",exact:true})).toBeVisible({timeout:180_000});await page.getByRole("button",{name:"Answer as Trader",exact:true}).click();
    await page.getByRole("button",{name:"Partial",exact:true}).click();await page.getByRole("textbox",{name:"File amount",exact:true}).fill("90600");await page.getByRole("textbox",{name:"Reason",exact:true}).fill("Goodwill: Hansa took a late Q3 cargo");await page.getByRole("button",{name:"Submit",exact:true}).click();
    await expect.poll(()=>evidence(since).memories.some((m:{kind:string;status:string})=>m.kind==="PRECEDENT"&&m.status==="PRECEDENT_ONLY"),{timeout:120_000}).toBe(true);
    await page.getByRole("tab",{name:"Memory",exact:true}).click();const precedent=page.locator('[data-memory-kind="PRECEDENT"][data-status="PRECEDENT_ONLY"]').first();await precedent.getByRole("button").first().click();await expect(precedent).toContainText("Not learned · commercial judgment");await shot(page,"precedent-only");
    await expect(page.getByRole("button",{name:"Answer as Controller",exact:true})).toBeVisible({timeout:120_000});await page.getByRole("button",{name:"Answer as Controller",exact:true}).click();
    await page.getByRole("combobox",{name:"Treatment port closure",exact:true}).selectOption("COUNT");await page.getByRole("textbox",{name:"Basis note",exact:true}).fill("CP cl. 8 proviso: already on demurrage");await page.getByRole("button",{name:"Save edit",exact:true}).click();await page.getByRole("button",{name:"Approve $122,150",exact:true}).click();
    await expect.poll(()=>evidence(since).memories.some((m:{kind:string;status:string})=>m.kind==="FACT"&&m.status==="PENDING_TEACHBACK"),{timeout:120_000}).toBe(true);
    await role(page,"CONTROLLER");await expect(page.getByRole("region",{name:"Teach back"})).toBeVisible();await shot(page,"fact-teachback");await page.getByRole("region",{name:"Teach back"}).getByRole("button").first().click();
    const fact=page.locator('[data-memory-kind="FACT"][data-status="ACTIVE"]');await expect(fact).toBeVisible();await expect(fact).toContainText("NEW");await fact.getByRole("button").first().click();await shot(page,"fact-active");
    await expect.poll(()=>convex("work:evidence",{since}).clockStatus,{timeout:120_000}).toBe("IDLE");
    const storm=convex("work:evidence",{since}),learning=evidence(since),money=convex("room:money",{caseCode:"DC-2026-0412"});
    expect(learning.jobs).toHaveLength(3);expect(learning.jobs.every((j:{state:string})=>j.state==="COMPLETE")).toBe(true);
    expect(storm.events.every((e:{origin:string})=>e.origin==="AUTOMATED_TEST")).toBe(true);
    expect(storm.asks.filter((a:{caseCode:string;kind:string})=>a.caseCode==="DC-2026-0412"&&!["TEACH_BACK","APPROVE_MEMORY"].includes(a.kind)).map((a:{kind:string})=>a.kind).sort()).toEqual(["COMMERCIAL_DECISION","PAYMENT_APPROVAL"]);
    const journals=convex("books:journals",{filter:"ALL"}).filter((j:{caseCode:string})=>j.caseCode==="DC-2026-0412");expect(journals.find((j:{kind:string})=>j.kind==="AP").cents).toBe(12_215_000);expect(convex("books:trialBalance",{}).balanced).toBe(true);
    const documents=convex("room:documents",{caseCode:"DC-2026-0412"});for(const kind of ["RECOVERY_CLAIM","DISPUTE_LETTER","LAYTIME_STATEMENT"]) expect(documents.some((d:{kind:string})=>d.kind===kind)).toBe(true);
    const report={phase:"V10",verified:true,realProvider:true,humanEvidence:false,origin:"AUTOMATED_TEST",model:"claude-sonnet-5-5",testProcedureSeed:false,ranAt:new Date().toISOString(),ops,storm,learning,money,journals,documents,sourceHashes:learningHashes()};
    writeFileSync(LEARNING_REPORT,JSON.stringify(report,null,1));expect(savedLearningEvidence()).toBeTruthy();
    await page.setViewportSize({width:1280,height:800});await page.reload();await expect(page.getByTestId("room-stage")).toBeVisible();await page.getByRole("tab",{name:"Memory",exact:true}).click();await shot(page,"memory-1280");restore();
  } catch(error) { writeFileSync("artifacts/v2/V10/live-incomplete.json",JSON.stringify({since,at:new Date().toISOString(),learning:evidence(since),storm:convex("work:evidence",{since})},null,2));throw error; }
});

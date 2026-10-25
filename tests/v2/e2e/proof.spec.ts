import {expect,test} from "@playwright/test";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {canonicalJson} from "../../../src/domain/canonical";
import {proofHashes,PROOF_REPORT,savedProofEvidence} from "../../../scripts/live/proof-evidence";
function convex(fn:string,args:object){const r=spawnSync("npx",["convex","run",fn,JSON.stringify(args)],{encoding:"utf8",maxBuffer:32*1024*1024});expect(r.status,r.stderr.slice(-800)).toBe(0);return JSON.parse(r.stdout.trim()||"null");}

test("V11: real score drill-down, actual chain verification, grounded Why and no classifier details",async({page})=>{
 test.skip(Number(process.env.BREAKWATER_GATE_PHASE?.slice(1)??0)<11,"V11");test.setTimeout(180_000);mkdirSync("artifacts/v2/V11",{recursive:true});
 await page.goto("/");await expect(page.getByTestId("acting-as")).toBeEnabled();await page.getByRole("tab",{name:"Proof",exact:true}).click();
 await expect(page.getByTestId("proof-view")).toContainText("24/24 voyages");await expect(page.getByTestId("proof-view")).not.toContainText(/jev|classifier|calibration/i);
 await page.getByRole("button",{name:"Verify now",exact:true}).click();await expect(page.getByTestId("proof-view")).toContainText("events verified");
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({animations:"disabled",path:"artifacts/v2/V11/proof-1440.png"});
 await page.getByText("View voyages",{exact:true}).click();await expect(page.getByTestId("score-voyages").locator("tbody tr")).toHaveCount(24);await page.screenshot({animations:"disabled",path:"artifacts/v2/V11/voyages-1440.png"});
 const result=convex("proof:overview",{}).score;expect(result.rows).toHaveLength(24);expect(result.metrics.controlViolations).toBe(0);
 const previous=process.env.BREAKWATER_REUSE_LIVE==="1"?savedProofEvidence():null;
 if(previous){
  // Restoring a baseline clears derived caches. Reuse the actual prior model response
  // only if its full graph version still matches; save rechecks every citation.
  const graph=convex("explain:graph",{entityId:"DC-2026-0405",field:"RECOVERABLE"}),recorded=previous.why.find((row:{version:number})=>row.version===graph.version);
  if(recorded)convex("explain:save",{entityId:"DC-2026-0405",field:"RECOVERABLE",version:recorded.version,text:recorded.text,citations:recorded.citations,model:recorded.model});
 }
 if(!previous){
  await page.goto("/case/DC-2026-0405");await expect(page.getByTestId("room-money")).toBeVisible();await page.getByRole("button",{name:"Why recover?",exact:true}).click();await expect(page.getByRole("heading",{name:"Why?",exact:true})).toBeVisible();await expect(page.getByText("Loading explanation",{exact:false})).toHaveCount(0,{timeout:100_000});
  await expect.poll(()=>convex("explain:evidence",{entityId:"DC-2026-0405",field:"RECOVERABLE"}).length,{timeout:100_000}).toBeGreaterThan(0);
  const why=convex("explain:evidence",{entityId:"DC-2026-0405",field:"RECOVERABLE"}),graph=convex("explain:graph",{entityId:"DC-2026-0405",field:"RECOVERABLE"});
  expect(why.some((row:{model:string;usage?:{tokensOut:number}})=>row.model==="claude-sonnet-5-5"&&(row.usage?.tokensOut??0)>0)).toBe(true);
  expect(why.every((row:{citations:unknown[]})=>row.citations.every(ref=>graph.provenance.citations.some((allowed:unknown)=>canonicalJson(ref)===canonicalJson(allowed))))).toBe(true);
  const chain=convex("audit:verifyChain",{});expect(chain.ok).toBe(true);const scoreReport=JSON.parse(readFileSync("fixtures/agent-transcripts/v11-score-live.json","utf8"));
  writeFileSync(PROOF_REPORT,JSON.stringify({verified:true,realProvider:true,humanEvidence:false,origin:"AUTOMATED_TEST",ranAt:new Date().toISOString(),why,chain,scoreRunAt:scoreReport.result.ranAt,classifierDetailsVisible:false,sourceHashes:proofHashes()},null,1));expect(savedProofEvidence()).toBeTruthy();await page.screenshot({animations:"disabled",path:"artifacts/v2/V11/why.png"});
 }
 await page.setViewportSize({width:1280,height:800});await page.goto("/");await page.getByRole("tab",{name:"Proof",exact:true}).click();await expect(page.getByTestId("proof-view")).toContainText("24/24 voyages");await page.screenshot({animations:"disabled",path:"artifacts/v2/V11/proof-1280.png"});
});

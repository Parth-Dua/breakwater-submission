import {spawnSync} from "node:child_process";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import type {ScoreVoyage} from "../../src/world/scoreboard";
import type {ScoreRow} from "../../src/domain/score";
const args=process.argv.slice(2),inputEstimate=2_400_000,outputEstimate=180_000;
console.log(`24 held-out voyages; estimated token cost: ${inputEstimate.toLocaleString()} input + ${outputEstimate.toLocaleString()} output. Approx. USD 6.60 at standard uncached Sonnet 5.5 rates (2/M input, 10/M output, verified 25 Oct 2026). Actual usage and failures will be recorded.`);
if(!args.includes("--yes")){console.log("Pass --yes to authorize the live provider run.");process.exit(2);}
function call<T>(fn:string,input:object):T{const r=spawnSync("npx",["convex","run",fn,JSON.stringify(input)],{encoding:"utf8",maxBuffer:32*1024*1024});if(r.status!==0)throw Error(`${fn}: ${r.stderr.slice(-700)}`);return JSON.parse(r.stdout.trim()||"null") as T;}
const fixture=JSON.parse(readFileSync("fixtures/world/scoreboard.json","utf8")) as {voyages:ScoreVoyage[]};
const model="claude-sonnet-5-5";const resumeIndex=args.indexOf("--run"),runId=resumeIndex>=0?args[resumeIndex+1]:call<string>("score:start",{model});
mkdirSync("artifacts/score",{recursive:true});writeFileSync("artifacts/score/latest.json",JSON.stringify({runId,startedAt:new Date().toISOString()}));
type Inspect={startedAt:number;vessel:string;busy:boolean;tasks:{kind:string;state:string;model:string|null;tokensIn:number;tokensOut:number}[];openAsks:{code:string;kind:string;role:string;subject:string}[];actual:ScoreRow["actual"];apPosted:boolean};
async function settle(caseCode:string,item:ScoreVoyage){
 for(let round=0;round<7;round++){
  const deadline=Date.now()+300_000;let state=call<Inspect>("score:inspect",{caseCode});
  while(state.busy){if(Date.now()>deadline)throw Error(`Score task timeout: ${caseCode}`);await new Promise(resolve=>setTimeout(resolve,1500));state=call<Inspect>("score:inspect",{caseCode});}
  if(!state.openAsks.length)return state;
  for(const ask of state.openAsks){let answer:object;
   if(ask.kind==="PAYMENT_APPROVAL")answer={optionId:item.answerKey.responder.controller};
   else if(ask.kind==="COMMERCIAL_DECISION")answer={optionId:item.answerKey.responder.trader};
   else if(ask.kind==="CONFIRM_FACT"){
    const optionId=item.answerKey.responder.confirmFacts??"CANT_FIND",release=item.customs.find(record=>record.kind==="RELEASE"),doc=release?.documentCode??item.documents.find(doc=>doc.kind==="SOF")?.code;
    answer={optionId,...(optionId==="CONFIRM"&&doc?{evidence:[{kind:"DOC",documentId:doc}]}:{})};
   }else throw Error(`Unexpected ask kind: ${ask.kind}`);
   call("asks:respondScripted",{ns:"score",askCode:ask.code,answer});
  }
 }
 throw Error("Scripted responder round limit");
}
const completed=call<{perVoyage:ScoreRow[]}>("score:result",{runId}).perVoyage;
for(const item of fixture.voyages){
 if(completed.some(row=>row.code===item.caseCode)){console.log(`${item.caseCode}: already recorded`);continue;}
 const caseCode=call<string>("score:stage",{runId,source:{caseCode:item.caseCode,voyageCode:item.voyage.code,openedAt:item.openedAt,ais:item.ais,customs:item.customs,documentCodes:item.documents.map(doc=>doc.code)}});
 let error:string|undefined;
 try{for(const doc of item.documents.filter(doc=>["NOR","SOF","OWNER_INVOICE"].includes(doc.kind)).sort((a,b)=>(a.receivedAt??0)-(b.receivedAt??0))){call("score:document",{caseCode,documentCode:doc.code});await settle(caseCode,item);}}
 catch(e){error=(e as Error).message.slice(0,500);}
 const observed=call<Inspect>("score:inspect",{caseCode});if(error)observed.actual.errors.push(error);if(!observed.apPosted)observed.actual.errors.push("No AP posted");
 const belowMaterialityCents=item.ownerInvoice.lines.filter(line=>line.minutes===undefined&&line.cents>0&&line.cents<25_000).reduce((n,line)=>n+line.cents,0);
 const row:ScoreRow&{actualCaseCode:string;tasks:Inspect["tasks"]}={code:item.caseCode,actualCaseCode:caseCode,vessel:observed.vessel,state:observed.actual.errors.length?"REVIEW":"COMPLETE",expected:{payableCents:item.answerKey.payableCents,recoverableCents:item.answerKey.recoverableCents,disputeLines:item.answerKey.disputeLines,asks:item.answerKey.expectedAsks,belowMaterialityCents},actual:observed.actual,wallMs:Date.now()-observed.startedAt,tasks:observed.tasks};
 call("score:record",{runId,row});console.log(`${item.caseCode}: ${row.state}, ${row.actual.tokensIn} in / ${row.actual.tokensOut} out, ${row.wallMs} ms`);
 const partial=call("score:result",{runId});writeFileSync("artifacts/score/latest-result.json",JSON.stringify(partial,null,2));
}
const result=call<{metrics:{status:string}}>("score:result",{runId});if(result.metrics.status!=="COMPLETE")throw Error("Score run incomplete");
const sources=["convex/score.ts","src/domain/score.ts","convex/sources/read.ts","src/domain/capabilities.ts","convex/schema.ts","convex/node/agent.ts","convex/node/claude.ts","convex/node/extract.ts","convex/node/prompts/agent.ts","convex/node/tools/definitions.ts","convex/agent/tools.ts","convex/agent/state.ts","convex/gateway.ts","convex/asks.ts","fixtures/world/scoreboard.json","fixtures/documents/manifest.json","src/world/caseBuilder.ts"];
const report={verified:true,realProvider:true,humanEvidence:false,origin:"SCRIPTED_RESPONDER",ranAt:new Date().toISOString(),result,sourceHashes:Object.fromEntries(sources.map(path=>[path,createHash("sha256").update(readFileSync(path)).digest("hex")]))};
writeFileSync("fixtures/agent-transcripts/v11-score-live.json",JSON.stringify(report,null,1));console.log(JSON.stringify(result,null,2));

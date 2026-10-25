import{readFileSync,mkdirSync,writeFileSync}from'node:fs';
import{spawnSync}from'node:child_process';
try{
 const{scenarioCode}=JSON.parse(readFileSync('artifacts/phase-06/automated-sequence.json','utf8')) as {scenarioCode:string};
 const result=spawnSync('node_modules/.bin/convex',['run','internal/learning:verifyAutomatedReconstruction',JSON.stringify({scenarioCode})],{encoding:'utf8',timeout:90_000});
 if(result.status!==0)throw new Error('Call failed');
 const report=JSON.parse(JSON.parse(result.stdout)) as {live:boolean;testsPassed:boolean;humanProof:boolean;candidateCreated:boolean};
 mkdirSync('artifacts/live',{recursive:true});writeFileSync('artifacts/live/learning-provider.json',JSON.stringify({...report,verifiedAt:new Date().toISOString()},null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exit(report.live&&report.testsPassed&&!report.humanProof&&!report.candidateCreated?0:1);
}catch{console.log(JSON.stringify({live:false,code:'AUTOMATED_RECONSTRUCTION_SMOKE_UNAVAILABLE'}));process.exit(1);}

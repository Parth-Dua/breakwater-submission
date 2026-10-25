import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
const result=spawnSync('node_modules/.bin/convex',['run','internal/learningStore:acceptance',JSON.stringify({scenarioCode:'breakwater-demo'})],{encoding:'utf8',timeout:45_000});
if(result.status!==0){console.log(JSON.stringify({status:'FAIL',code:'LIVE_LEARNING_VERIFICATION_UNAVAILABLE'}));process.exit(1);}
try{
 const report=JSON.parse(JSON.parse(result.stdout)) as {status:string;code:string};
 mkdirSync('artifacts/live',{recursive:true});writeFileSync('artifacts/live/learning.json',JSON.stringify({...report,verifiedAt:new Date().toISOString(),evidenceKind:'Actual human UI session and real cloud Claude reconstruction; automated sessions excluded'},null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exit(report.status==='PASS'?0:1);
}catch{console.log(JSON.stringify({status:'FAIL',code:'INVALID_LEARNING_VERIFICATION_REPORT'}));process.exit(1);}

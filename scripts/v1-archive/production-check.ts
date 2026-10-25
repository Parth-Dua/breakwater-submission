import{spawnSync}from'node:child_process';
import{existsSync,readFileSync,mkdirSync,writeFileSync}from'node:fs';
const dashboard=spawnSync('node_modules/.bin/convex',['dashboard','--prod','--no-open'],{encoding:'utf8',timeout:60_000});
const name=dashboard.stdout.match(/https:\/\/dashboard\.convex\.dev\/(?:d\/|t\/[^\s/]+\/[^\s/]+\/)([a-z0-9-]+)/)?.[1];
const actual=process.env.BREAKWATER_LIVE_CONVEX_URL;
const local=existsSync('.env.local')?readFileSync('.env.local','utf8').match(/^CONVEX_DEPLOYMENT\s*=\s*["']?([^\s"'#]+)/m)?.[1]:undefined;
const selected=process.env.CONVEX_DEPLOYMENT??local;
const matches=dashboard.status===0&&!!name&&actual===`https://${name}.convex.cloud`&&selected===`prod:${name}`;
let healthy=false;if(matches){const result=spawnSync('node_modules/.bin/convex',['run','health:status','--prod'],{encoding:'utf8',timeout:60_000});try{healthy=result.status===0&&JSON.parse(result.stdout).status==='ok';}catch{/* Never echo raw auth/control-plane errors. */}}
const report={status:matches&&healthy?'PASS':'BLOCKED',code:matches&&healthy?'ACTUAL_PRODUCTION_BACKEND_VERIFIED':'PRODUCTION_BACKEND_AND_CLI_TARGET_REQUIRED',configuredFrontendBackend:actual??null,expectedProductionBackend:name?`https://${name}.convex.cloud`:null,cliTargetsProduction:selected===`prod:${name}`,productionHealthVerified:healthy,verifiedAt:new Date().toISOString()};
mkdirSync('artifacts/live',{recursive:true});writeFileSync('artifacts/live/production.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exit(report.status==='PASS'?0:1);

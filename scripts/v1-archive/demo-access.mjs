import {spawnSync} from 'node:child_process';
import {writeFileSync,chmodSync} from 'node:fs';
const selection=process.argv.slice(2);
if(selection.length>1||selection.length===1&&selection[0]!=='--prod')throw new Error('Expected optional --prod only');
const result=spawnSync('node_modules/.bin/convex',['env','get','BREAKWATER_DEMO_CREDENTIALS',...selection],{encoding:'utf8',timeout:60_000});
if(result.status!==0)throw new Error('Cloud access unavailable. Run npx convex login; raw output suppressed.');
let accounts;try{accounts=JSON.parse(result.stdout);if(!Array.isArray(accounts)||accounts.length!==4)throw new Error();}catch{throw new Error('Demo accounts are not configured in the selected Convex deployment.');}
const file='demo-access.local.md';
const text=['# Private Breakwater demo sign-in',`Environment: ${selection.length?'Convex production':'your-deployment-name (the deployed hackathon demo)'}`, 'App: https://your-app.example/sign-in','Keep this file private. It is ignored by Git.','',...accounts.map(a=>`${a.role}: ${a.email}\nPassword: ${a.password}\n`)].join('\n');
writeFileSync(file,text,{mode:0o600});chmodSync(file,0o600);console.log(`Saved ${accounts.length} sign-in details to ${file}; values suppressed in command output.`);

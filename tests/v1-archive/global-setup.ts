import{execFile}from'node:child_process';
import{promisify}from'node:util';
const run=promisify(execFile);
// Fetch once before workers launch. Credentials stay in process memory; no traces/files/stdout.
export default async function setup(){
 const names={demo:'BREAKWATER_DEMO_CREDENTIALS',operations:'BREAKWATER_AUTOMATION_CREDENTIALS',controller:'BREAKWATER_AUTOMATION_CONTROLLER_CREDENTIALS',admin:'BREAKWATER_AUTOMATION_ADMIN_CREDENTIALS'};
 const pairs=await Promise.all(Object.entries(names).map(async([kind,name])=>{for(let attempt=0;attempt<2;attempt++){try{const{stdout}=await run('node_modules/.bin/convex',['env','get',name],{encoding:'utf8',timeout:60_000});const value:unknown=JSON.parse(stdout);if(kind==='demo'?!Array.isArray(value):!value||typeof value!=='object')throw new Error();return[kind,value] as const;}catch{if(attempt===1)throw new Error(`Secure browser credential prefetch unavailable for ${kind}; raw output suppressed`);}}throw new Error('Credential prefetch exhausted');}));
 process.env.BREAKWATER_TEST_IDENTITIES=JSON.stringify(Object.fromEntries(pairs));
}

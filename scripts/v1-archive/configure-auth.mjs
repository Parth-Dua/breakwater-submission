import { generateKeyPairSync,randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const selection=process.argv.slice(2);
if(selection.length>1||(selection.length===1&&selection[0]!=="--prod"))throw new Error("Expected optional --prod only");
function cli(args,input){
  const result=spawnSync("node_modules/.bin/convex",[...args,...selection],{input,encoding:"utf8",stdio:["pipe","pipe","pipe"],timeout:60_000});
  if(result.status!==0)throw new Error(`Convex command failed (${args[0]}, exit ${result.status ?? "timeout"}); secret-bearing output suppressed`);
  return result.stdout;
}
const names=new Set(cli(["env","list","--names-only"]).trim().split(/\s+/));
if(!names.has("JWT_PRIVATE_KEY")&&!names.has("JWKS")){
  const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
  cli(["env","set","JWT_PRIVATE_KEY"],privateKey.export({format:"pem",type:"pkcs8"}).toString());
  cli(["env","set","JWKS"],JSON.stringify({keys:[{...publicKey.export({format:"jwk"}),use:"sig",alg:"RS256"}]}));
}else if(!names.has("JWT_PRIVATE_KEY")||!names.has("JWKS")){
  throw new Error("Incomplete existing signing configuration; reconcile the key pair before proceeding");
}
if(!names.has("BREAKWATER_DEMO_CREDENTIALS")){
  const identities=[
    {role:"operations_reviewer",email:"operations@meridian.example",displayName:"Morgan Lee"},
    {role:"finance_controller",email:"controller@meridian.example",displayName:"Alex Rivera"},
    {role:"auditor",email:"auditor@meridian.example",displayName:"Sam Chen"},
    {role:"demo_admin",email:"admin@meridian.example",displayName:"Riley Park"},
  ].map(identity=>({...identity,password:randomBytes(24).toString("base64url")}));
  cli(["env","set","BREAKWATER_DEMO_CREDENTIALS"],JSON.stringify(identities));
}
if(!names.has("BREAKWATER_AUTOMATION_CREDENTIALS")){
  cli(["env","set","BREAKWATER_AUTOMATION_CREDENTIALS"],JSON.stringify({role:"operations_reviewer",email:"automation-operations@meridian.example",displayName:"Automated Operations Test",password:randomBytes(24).toString("base64url")}));
}
if(!names.has("BREAKWATER_AUTOMATION_CONTROLLER_CREDENTIALS")){
  cli(["env","set","BREAKWATER_AUTOMATION_CONTROLLER_CREDENTIALS"],JSON.stringify({role:"finance_controller",email:"automation-controller@meridian.example",displayName:"Automated Controller UI Test",password:randomBytes(24).toString("base64url")}));
}
if(!names.has("BREAKWATER_AUTOMATION_ADMIN_CREDENTIALS")){
  cli(["env","set","BREAKWATER_AUTOMATION_ADMIN_CREDENTIALS"],JSON.stringify({role:"demo_admin",email:"automation-admin@meridian.example",displayName:"Automated Scenario Admin Test",password:randomBytes(24).toString("base64url")}));
}
console.log("Convex Auth signing configuration and demo credentials configured. Values remain in cloud environment only.");

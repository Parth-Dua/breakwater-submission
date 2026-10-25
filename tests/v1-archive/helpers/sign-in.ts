import { spawnSync } from "node:child_process";
import { expect,type Page } from "@playwright/test";
export type DemoRole="operations_reviewer"|"finance_controller"|"auditor"|"demo_admin";
type Credential={email:string;password:string;role:DemoRole;displayName:string};
let credentials:Credential[]|undefined;
const automationCredentials:Partial<Record<"operations"|"controller"|"admin",Credential>>={};
function getAutomationCredential(kind:"operations"|"controller"|"admin"){
 if(automationCredentials[kind])return automationCredentials[kind];
 if(process.env.BREAKWATER_TEST_IDENTITIES){const identity=JSON.parse(process.env.BREAKWATER_TEST_IDENTITIES)[kind] as Credential;if(!identity?.email||!identity.password)throw new Error("Prefetched automation credential missing");automationCredentials[kind]=identity;return identity;}
 const result=spawnSync("node_modules/.bin/convex",["env","get",kind==="admin"?"BREAKWATER_AUTOMATION_ADMIN_CREDENTIALS":kind==="controller"?"BREAKWATER_AUTOMATION_CONTROLLER_CREDENTIALS":"BREAKWATER_AUTOMATION_CREDENTIALS"],{encoding:"utf8",timeout:30_000});
 if(result.status!==0)throw new Error("Automation identity configuration unavailable");
 const value:unknown=JSON.parse(result.stdout);
 if(!value||typeof value!=="object"||!("email" in value)||!("password" in value)||!("role" in value)||!("displayName" in value))throw new Error("Invalid automation identity configuration");
 automationCredentials[kind]=value as Credential;return automationCredentials[kind];
}
function getCredentials(){
  if(credentials)return credentials;
  if(process.env.BREAKWATER_TEST_IDENTITIES){const identities=JSON.parse(process.env.BREAKWATER_TEST_IDENTITIES).demo as Credential[];if(!Array.isArray(identities)||identities.length!==4)throw new Error("Prefetched demo credentials missing");credentials=identities;return identities;}
  const result=spawnSync("node_modules/.bin/convex",["env","get","BREAKWATER_DEMO_CREDENTIALS"],{encoding:"utf8",timeout:30_000});
  if(result.status!==0||!result.stdout.trim())throw new Error("Live demo credentials unavailable; provision the cloud identities before browser gates");
  const parsed:unknown=JSON.parse(result.stdout);
  if(!Array.isArray(parsed)||parsed.some(value=>typeof value?.email!=="string"||typeof value?.password!=="string"||typeof value?.role!=="string"))throw new Error("Invalid cloud demo credential configuration");
  credentials=parsed as Credential[];return credentials;
}
export async function signInAs(page:Page,role:DemoRole|"automation_operations"|"automation_controller"|"automation_admin"){
  const identity=role==="automation_admin"?getAutomationCredential("admin"):role==="automation_operations"?getAutomationCredential("operations"):role==="automation_controller"?getAutomationCredential("controller"):getCredentials().find(value=>value.role===role);if(!identity)throw new Error("Required demo identity missing");
  try{
    await page.goto("/sign-in");
    await page.getByLabel("Email",{exact:true}).fill(identity.email);
    await page.getByLabel("Password",{exact:true}).fill(identity.password);
    await page.getByRole("button",{name:"Sign in",exact:true}).click();
    await expect(page).toHaveURL(/\/overview$/, {timeout:30_000});
    await expect(page.locator(".identity-name")).toContainText(identity.displayName,{timeout:15_000});
  }catch{
    await page.locator('input[type="password"]').fill("").catch(()=>{});
    // Never allow Playwright's password-fill call arguments into failure reports.
    throw new Error(`Live sign-in failed for ${role}; sensitive action details suppressed`);
  }
}

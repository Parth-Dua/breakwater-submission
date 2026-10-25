import {test,expect} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {signInAs} from '../helpers/sign-in';
function cloud(name:string,args:Record<string,unknown>){const result=spawnSync('node_modules/.bin/convex',['run',name,JSON.stringify(args)],{encoding:'utf8',timeout:45_000});if(result.status!==0)throw new Error(`Cloud verification failed: ${name}; sensitive output suppressed`);return result.stdout.trim()?JSON.parse(result.stdout) as unknown:null;}
test('Admin injects a source period lock and resets only the assigned isolated UI namespace',async({page})=>{
 const scenarioCode=`breakwater-demo-ui${Date.now().toString(36)}admin`;
 cloud('internal/automation:prepareScenarioAdmin',{scenarioCode});
 await signInAs(page,'automation_admin');await page.goto('/scenarios');
 await expect(page.locator('.scenario-context')).toContainText(scenarioCode);
 await page.getByLabel('Condition',{exact:true}).selectOption('LOCKED_PERIOD');
 await page.getByLabel('Affected claim',{exact:true}).selectOption({label:'CL-203 · RECEIVED'});
 await page.getByLabel('Accounting period source',{exact:true}).selectOption({label:'FY2026 · OPEN'});
 await page.getByRole('button',{name:'Inject source condition',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Source condition recorded');
 await expect(page.getByLabel('Accounting period source',{exact:true})).toContainText('FY2026 · LOCKED');
 mkdirSync('artifacts/phase-09',{recursive:true});
 await page.screenshot({path:'artifacts/phase-09/scenarios-desktop.png',fullPage:true});
 await page.goto('/audit');await page.getByLabel('Event type',{exact:true}).fill('SCENARIO_INPUT_INJECTED');await page.getByRole('button',{name:'Filter audit records',exact:true}).click();
 await expect(page.locator('.audit-events')).toContainText('SCENARIO INPUT INJECTED');await expect(page.locator('.audit-events')).toContainText('demo admin');
 await page.locator('.audit-events summary').first().click();await expect(page.locator('.audit-events')).toContainText('OPEN → LOCKED');await expect(page.locator('.audit-events a').first()).toHaveAttribute('href',/\/claims\//);
 await page.screenshot({path:'artifacts/phase-09/audit-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:'artifacts/phase-09/audit-mobile.png'});
 await page.goto('/scenarios');await page.getByLabel(`Type ${scenarioCode} to confirm`,{exact:true}).fill(scenarioCode);await page.getByRole('button',{name:'Reset isolated demo',exact:true}).click();await expect(page.getByRole('status')).toContainText('Isolated baseline restored');await expect(page.locator('.scenario-context')).toContainText('12 synthetic claims');await page.getByLabel('Condition',{exact:true}).selectOption('LOCKED_PERIOD');await expect(page.getByLabel('Accounting period source',{exact:true})).toContainText('FY2026 · OPEN');expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:'artifacts/phase-09/scenarios-mobile.png'});
});
test('Canonical live learning, human approval, unseen/BETA execution and balanced posting @requires-human-approval',async({page})=>{
 const evidence=JSON.parse(cloud('internal/approvalEvidence:verify',{scenarioCode:'breakwater-demo',sourceClaimCode:'CL-203',unseenClaimCode:'CL-204',nearMissClaimCode:'CL-205'}) as string) as {status:string;code:string;procedureCode:string|null};
 expect(evidence.status,`Required actual human demo proof is pending: ${evidence.code}`).toBe('PASS');
 await signInAs(page,'auditor');await page.goto(`/memory/${evidence.procedureCode}`);await expect(page.locator('.memory-executions')).toContainText('APPLIED');await page.goto('/ledger');await expect(page.locator('.journal-detail').filter({hasText:'ACCRUAL_REVERSAL'})).toHaveCount(1);await expect(page.locator('.journal-detail').filter({hasText:'Posted · balanced'})).toHaveCount(3);
});

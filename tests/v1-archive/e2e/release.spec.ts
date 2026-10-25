import{test,expect}from'@playwright/test';
import{mkdirSync,readFileSync,writeFileSync}from'node:fs';
import{spawnSync}from'node:child_process';
import{signInAs}from'../helpers/sign-in';
const deployed=process.env.PLAYWRIGHT_BASE_URL?.startsWith('https://');
test.skip(!deployed,'Deployment checks require an explicit HTTPS PLAYWRIGHT_BASE_URL; local phases retain their own UI coverage.');
const folder='artifacts/phase-10';
test('public Vercel release reports its actual commit/backend and enforces route authentication',async({request,page})=>{
 const response=await request.get('/api/release');expect(response.status()).toBe(200);const data=await response.json();expect(data.service).toBe('breakwater');expect(data.frontendEnvironment).toBe('production');expect(data.convexDeployment).toBe(new URL(process.env.BREAKWATER_LIVE_CONVEX_URL??'https://your-deployment-name.convex.cloud').hostname);expect(data.commit).toMatch(/^[a-f0-9]{40}$/);if(process.env.BREAKWATER_EXPECTED_SHA)expect(data.commit).toBe(process.env.BREAKWATER_EXPECTED_SHA);
 await page.goto('/claims');await expect(page).toHaveURL(/\/sign-in$/);mkdirSync(folder,{recursive:true});writeFileSync(`${folder}/deployment.json`,JSON.stringify({...data,url:process.env.PLAYWRIGHT_BASE_URL,verifiedAt:new Date().toISOString(),humanDemoVerified:false},null,2)+'\n');
});
test('deployed reader sees real data, map, responsive claims, balanced ledger and audit',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await signInAs(page,'auditor');await expect(page.locator('.stat-grid')).toBeVisible();mkdirSync(folder,{recursive:true});await page.screenshot({path:`${folder}/01-overview.png`,fullPage:true});
 await page.goto('/claims/CL-203');await expect(page.getByTestId('trajectory-map')).toHaveAttribute('data-loaded','true');await expect(page.locator('.figure-claimed')).toContainText('$30,000');await page.screenshot({path:`${folder}/02-v203.png`,fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:`${folder}/07-mobile-claim.png`});await page.setViewportSize({width:1440,height:1000});
 await page.goto('/memory');await expect(page.locator('.memory-record').first()).toBeVisible();await page.screenshot({path:`${folder}/05-memory-actual-state.png`,fullPage:true});
 await page.goto('/ledger');const journal=page.locator('.journal-detail').filter({hasText:'ACCRUAL-V-203'});await journal.locator('summary').click();await expect(journal).toContainText('Posted · balanced');await page.screenshot({path:`${folder}/06-balanced-ledger.png`,fullPage:true});await page.goto('/audit');await expect(page.locator('.audit-filters')).toBeVisible();await expect(page.locator('.audit-events')).toBeVisible();await page.screenshot({path:`${folder}/audit.png`,fullPage:true});
});
test('deployed role identities and explicitly automated review provenance render without approving',async({page})=>{
 test.setTimeout(150_000);
 await signInAs(page,'operations_reviewer');await page.goto('/work');await expect(page.getByRole('heading',{name:'Work Queue',exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await signInAs(page,'finance_controller');await page.goto('/memory');await expect(page.getByRole('heading',{name:'Institutional Memory',exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await signInAs(page,'demo_admin');await page.goto('/scenarios');await expect(page.locator('.scenario-context')).toContainText('breakwater-demo');await page.getByRole('button',{name:'Sign out',exact:true}).click();
 // These screenshots use only actual AUTOMATED_TEST sessions, with production learning/approval explicitly blocked.
 const{scenarioCode}=JSON.parse(readFileSync('artifacts/phase-06/automated-sequence.json','utf8')) as{scenarioCode:string};const result=spawnSync('node_modules/.bin/convex',['run','internal/automation:prepareControllerPreview',JSON.stringify({scenarioCode})],{encoding:'utf8',timeout:45_000});if(result.status!==0)throw new Error('Actual automated display evidence unavailable; raw diagnostics suppressed');const code=JSON.parse(result.stdout)as string;
 await signInAs(page,'automation_controller');await page.goto(`/memory/${code}`);await expect(page.getByText('AUTOMATED TEST · not human-learning proof · approval is blocked',{exact:true})).toBeVisible();await expect(page.locator('.counterexample-panel tbody tr')).toHaveCount(12);await page.screenshot({path:`${folder}/04-controller-automated-preview.png`,fullPage:true});await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await signInAs(page,'automation_operations');await page.goto('/work');await page.getByRole('link',{name:'Review delay cause — V-203',exact:true}).click();await expect(page.getByRole('heading',{name:'Finding submitted · CUSTOMS',exact:true})).toBeVisible();await page.screenshot({path:`${folder}/03-operations-automated-evidence.png`,fullPage:true});
});

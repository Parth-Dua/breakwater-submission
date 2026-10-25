import { expect,test } from "@playwright/test";
import { signInAs } from "../helpers/sign-in";
test("unauthenticated protected routes redirect to sign-in",async({page})=>{
  await page.goto("/claims");await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading",{name:"Sign in",exact:true})).toBeVisible();
});
test("real Operations and Controller identities persist across reloads with server roles",async({page})=>{
  await signInAs(page,"operations_reviewer");
  await page.goto("/claims");await expect(page.getByRole("link",{name:"CL-203",exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole("link",{name:"CL-203",exact:true})).toBeVisible();
  await expect(page.locator(".identity-label")).toContainText("operations reviewer");
  await expect(page.getByRole("navigation").getByRole("link",{name:"Scenario Controls"})).toHaveCount(0);
  await page.getByRole("button",{name:"Sign out",exact:true}).click();await expect(page).toHaveURL(/\/sign-in$/);
  await signInAs(page,"finance_controller");await expect(page.locator(".identity-label")).toContainText("finance controller");
  await page.goto("/claims/CL-203");await expect(page.getByRole("heading",{name:"Claim CL-203",exact:true})).toBeVisible();
  await expect(page.locator(".figure-claimed")).toContainText("$30,000");await expect(page.locator(".figure-unverified")).toContainText("$20,000");
});
test("only the authenticated Demo Admin sees scenario navigation",async({page})=>{
  await signInAs(page,"demo_admin");await expect(page.getByRole("navigation").getByRole("link",{name:"Scenario Controls",exact:true})).toBeVisible();
});

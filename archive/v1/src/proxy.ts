import { convexAuthNextjsMiddleware,createRouteMatcher,nextjsMiddlewareRedirect } from "@convex-dev/auth/nextjs/server";
const isProtected=createRouteMatcher(["/claims(.*)","/work(.*)","/memory(.*)","/ledger(.*)","/audit(.*)","/scenarios(.*)"]);
export default convexAuthNextjsMiddleware(async(request,{convexAuth})=>{
  if(isProtected(request)&&!(await convexAuth.isAuthenticated()))return nextjsMiddlewareRedirect(request,"/sign-in");
});
export const config={matcher:["/((?!.*\\..*|_next).*)","/","/(api|trpc)(.*)"]};

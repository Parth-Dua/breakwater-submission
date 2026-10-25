export const dynamic='force-dynamic';
export function GET(){
 const url=process.env.NEXT_PUBLIC_CONVEX_URL;
 return Response.json({service:'breakwater',commit:process.env.VERCEL_GIT_COMMIT_SHA??null,frontendEnvironment:process.env.VERCEL_ENV??'local',convexDeployment:url?new URL(url).hostname:null,synthetic:true},{headers:{'Cache-Control':'no-store'}});
}

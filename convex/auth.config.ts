import type { AuthConfig } from "convex/server";
const config={providers:[{domain:process.env.CONVEX_SITE_URL!,applicationID:"convex"}]} satisfies AuthConfig;
export default config;

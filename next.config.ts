import type { NextConfig } from "next";

// v1 routes are retired (UI REQ-UI-01); everything lands on the Desk.
const RETIRED_ROUTES = ["/overview", "/claims", "/work", "/memory", "/ledger", "/audit", "/scenarios", "/sign-in"];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  turbopack: { root: process.cwd() },
  async redirects() {
    return RETIRED_ROUTES.flatMap(route => [
      { source: route, destination: "/", permanent: false },
      { source: `${route}/:path*`, destination: "/", permanent: false },
    ]);
  },
};

export default nextConfig;

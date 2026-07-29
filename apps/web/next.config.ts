import type { NextConfig } from "next";

// Proxies browser requests to /api/* through to the NestJS API, so the
// browser only ever talks to this app's own origin. This is what makes
// the session cookie (SameSite=Lax, ADR-0005) work at all: a direct
// cross-origin fetch from apps/web to apps/api wouldn't carry the
// cookie, since Lax only sends it on top-level navigations and "safe"
// requests, not on a fetch/XHR to a different origin. Making them the
// same origin from the browser's point of view avoids that entirely,
// no CORS, no SameSite=None/Secure complications for local http dev.
// See ADR-0012.
const API_URL = process.env.API_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;

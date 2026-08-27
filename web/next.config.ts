import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  // `/gate` owns the product's verb in the URL. It is a transparent alias of
  // `/verify` — the rewrite serves the same gate page while keeping `/gate`
  // in the browser bar, so every shared gate link carries the verb.
  async rewrites() {
    return [
      {
        source: "/gate",
        destination: "/verify",
      },
    ];
  },
  // Security + caching headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Embed widget can be framed anywhere
        source: "/embed/:path*",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
        ],
      },
    ];
  },
  // Compress responses
  compress: true,
  // Power by header off (minor info leak)
  poweredByHeader: false,
};

export default nextConfig;

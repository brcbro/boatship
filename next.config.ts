import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenNext Cloudflare adapter consumes this config at deploy time.
  // Local `next dev` / `next build` use the Node.js runtime for API routes.
  output: "standalone",
  // Keep local data, environment files, and tooling out of the server trace.
  outputFileTracingExcludes: {
    "/*": [
      ".data/**/*", ".env*", ".wrangler/**/*", ".open-next/**/*", ".git/**/*",
      ".next/dev/**/*", ".next/standalone/**/*", "tests/**/*", "scripts/**/*",
      "node_modules/firebase-tools/**/*",
    ],
  },
  // Next 16 uses Turbopack by default; declare it so no webpack override applies.
  turbopack: {},
  experimental: { globalNotFound: true },
};

export default nextConfig;

// Enable when deploying with: npm run deploy
// import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
// initOpenNextCloudflareForDev();

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenNext Cloudflare adapter consumes this config at deploy time.
  // Local `next dev` / `next build` use the Node.js runtime for API routes.
};

export default nextConfig;

// Enable when deploying with: npm run deploy
// import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
// initOpenNextCloudflareForDev();

import type { NextConfig } from "next";

// The generated Prisma client targets Cloudflare, but `next dev` runs under
// Node.js. Prisma requires this flag so its WASM query compiler is initialized
// when that Cloudflare client is exercised locally.
process.env.PRISMA_CLIENT_FORCE_WASM ??= "1";

const nextConfig: NextConfig = {
  // OpenNext Cloudflare adapter consumes this config at deploy time.
  // Local `next dev` / `next build` use the Node.js runtime for API routes.
  output: "standalone",
  // Next 16 uses Turbopack by default. Declaring it prevents the old webpack
  // override from forcing Prisma's `?module` WASM import down an incompatible
  // bundling path during local development.
  turbopack: {},
};

export default nextConfig;

// Enable when deploying with: npm run deploy
// import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
// initOpenNextCloudflareForDev();

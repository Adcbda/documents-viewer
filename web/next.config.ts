import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained Node.js server for Docker and other self-hosted
  // environments. Cloudflare/Sites builds continue to use the same app code.
  output: "standalone",
};

export default nextConfig;

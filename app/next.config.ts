import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // native / heavy server-only packages stay out of the bundle
  serverExternalPackages: ["@react-pdf/renderer", "@node-rs/argon2", "pg"],
  output: "standalone",
  // bank files are sent to server actions as text
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;

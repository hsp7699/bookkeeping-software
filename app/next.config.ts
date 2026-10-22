import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // native / heavy server-only packages stay out of the bundle
  serverExternalPackages: ["@react-pdf/renderer", "@node-rs/argon2", "pg"],
  output: "standalone",
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // native / heavy server-only packages stay out of the bundle
  serverExternalPackages: ["@react-pdf/renderer", "@node-rs/argon2", "pg"],
  output: "standalone",
  // the PDF library loads its built-in fonts dynamically, so tracing misses them
  outputFileTracingIncludes: { "/**": ["./node_modules/pdfkit/js/standard-fonts/**", "./node_modules/pdfkit/js/data/**"] },
  // bank files are sent to server actions as text
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;

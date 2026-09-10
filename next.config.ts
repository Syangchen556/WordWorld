import type { NextConfig } from "next";
const config: NextConfig = {
  distDir:
    process.env.NEXT_DIST_DIR ||
    (process.env.NODE_ENV === "production" ? ".next" : ".next-dev"),
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ["pg", "@electric-sql/pglite", "word-list"],
  outputFileTracingIncludes: {
    "/api/*": ["./node_modules/word-list/words.txt"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;

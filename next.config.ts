import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  // The dev-only "N" badge would sit on the phone tab bar or header; errors still show without it.
  devIndicators: false,
  // The end-to-end tests build into their own folder so they can run next to `pnpm dev`.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;

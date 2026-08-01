import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * These three must stay out of the bundler: PGlite ships a WASM binary,
   * postgres.js and googleapis are CJS with dynamic requires. Bundling any of
   * them produces a runtime failure rather than a build error.
   */
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "googleapis"],
};

export default nextConfig;

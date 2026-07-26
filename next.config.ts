import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Artifact pages are served at the subdomain root and reference assets by
  // relative URL; we own trailing-slash behavior in the artifact route rather
  // than letting Next 308 in front of API POSTs.
  skipTrailingSlashRedirect: true,
  // Security headers are set per-response in code (middleware + route
  // handlers), not here: the robots invariant and sandbox CSP depend on
  // per-site state that static config cannot express.
};

export default nextConfig;

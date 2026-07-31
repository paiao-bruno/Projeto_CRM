import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, "../..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;

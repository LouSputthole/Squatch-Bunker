import type { NextConfig } from "next";
import packageJson from "./package.json";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
  output: "standalone",
  turbopack: { root: projectRoot },
};

export default nextConfig;

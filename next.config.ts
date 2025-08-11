import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Removed 'output: export' to support dynamic routes
  // Static export doesn't work with dynamic poll IDs
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

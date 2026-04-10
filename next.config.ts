import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['jsdom', '@mozilla/readability', 'rss-parser'],
};

export default nextConfig;

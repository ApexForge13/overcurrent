import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['jsdom', '@mozilla/readability', 'rss-parser'],
  async headers() {
    return [
      {
        source: '/api/og',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, s-maxage=86400' },
        ],
      },
      {
        source: '/api/stories',
        headers: [
          { key: 'Cache-Control', value: 'public, s-maxage=60, stale-while-revalidate=300' },
        ],
      },
      {
        source: '/api/reports',
        headers: [
          { key: 'Cache-Control', value: 'public, s-maxage=60, stale-while-revalidate=300' },
        ],
      },
    ]
  },
};

export default nextConfig;

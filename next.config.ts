import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Work module became the Teaching add-on (Nov 2026): old links and bookmarks keep working.
  async redirects() {
    return [
      { source: "/work", destination: "/teaching", permanent: false },
      { source: "/work/:path*", destination: "/teaching/:path*", permanent: false },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;

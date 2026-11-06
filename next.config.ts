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
  // Notes search: the PDF reader ("unpdf", installed with INSTALAR-BUSCADOR.cmd) is loaded at run time
  // only, so it must be shipped with the routes that read files (the cron and the search page's actions).
  serverExternalPackages: ["unpdf"],
  outputFileTracingIncludes: {
    "/api/cron/reminders": ["./node_modules/unpdf/**/*"],
    "/search": ["./node_modules/unpdf/**/*"],
  },
};

export default nextConfig;

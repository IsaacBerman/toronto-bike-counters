import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Short link for sharing the 2026 election results. Permanent (308),
      // so search engines list /elections rather than the short link.
      {
        source: "/toronto-2026",
        destination: "/elections?race=mayor-2026",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

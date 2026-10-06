import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Short link for sharing the 2026 election-night results. Temporary
      // (307) rather than permanent, so it can point somewhere else after the
      // election without browsers having cached the old target.
      {
        source: "/toronto-2026",
        destination: "/elections?race=mayor-2026",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

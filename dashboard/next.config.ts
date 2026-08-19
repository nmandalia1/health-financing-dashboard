import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  // The PFM section used to be its own route tree. It is now a lens, addressed
  // by scope like every other lens, so the old paths forward to their new homes.
  // Permanent: these URLs are not coming back.
  async redirects() {
    return [
      { source: "/pfm/country/:iso3", destination: "/country/:iso3/pfm", permanent: true },
      { source: "/pfm/chain", destination: "/global/pfm/chain", permanent: true },
      { source: "/pfm/last-mile", destination: "/global/pfm/last-mile", permanent: true },
      { source: "/pfm", destination: "/global/pfm", permanent: true },
    ];
  },
};

export default nextConfig;

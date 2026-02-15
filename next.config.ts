import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  async rewrites() {
    return [
      {
        source: "/player_api.php",
        destination: "/api/xtream?_type=api",
      },
      {
        source: "/get.php",
        destination: "/api/xtream?_type=m3u",
      },
      {
        source: "/xmltv.php",
        destination: "/api/epg",
      },
    ];
  },
};

export default nextConfig;

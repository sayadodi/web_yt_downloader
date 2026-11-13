import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ship the yt-dlp binary with every API function.
  outputFileTracingIncludes: {
    "/api/**": ["./bin/**"],
  },
  // ffmpeg-static resolves its binary path at runtime from node_modules.
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;

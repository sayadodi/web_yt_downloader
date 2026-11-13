import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ship both yt-dlp and ffmpeg binaries with every API function.
  outputFileTracingIncludes: {
    "/api/**": [
      "./bin/**",
      "./node_modules/ffmpeg-static/**",
    ],
  },
  // ffmpeg-static resolves its binary path at runtime from node_modules.
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;

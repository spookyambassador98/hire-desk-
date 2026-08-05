import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["undici", "cheerio", "firebase-admin"],
};

export default nextConfig;

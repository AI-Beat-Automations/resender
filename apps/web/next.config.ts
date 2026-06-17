import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui"],
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok.app"],
}

export default nextConfig

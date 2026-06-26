import createMDX from "@next/mdx"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui"],
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok.app"],
  // Let `.md`/`.mdx` files act as routes (e.g. app/docs/page.mdx).
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
}

const withMDX = createMDX({})

export default withMDX(nextConfig)

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare"
import createMDX from "@next/mdx"
import type { NextConfig } from "next"

import { DOCS_URL } from "./lib/site-config"

// Permite acceder a bindings de Cloudflare durante `next dev`.
initOpenNextCloudflareForDev()

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui"],
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok.app"],
  // MDX sigue habilitado como extensión de página para futuros contenidos.
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],

  // Los docs se construyen en otro repo y se publican en docs.resender.dev.
  // El 301 (en vez de borrar la ruta a secas) conserva la autoridad de
  // /docs, que ya está indexada, y no deja 404 a quien tenga el link viejo.
  async redirects() {
    return [
      { source: "/docs", destination: DOCS_URL, permanent: true },
      { source: "/docs/:path*", destination: DOCS_URL, permanent: true },
    ]
  },
}

const withMDX = createMDX({})

export default withMDX(nextConfig)

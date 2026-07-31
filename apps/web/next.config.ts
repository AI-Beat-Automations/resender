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

  // `docs.resender.dev` aún publica el contrato legado. Mientras se actualiza,
  // /docs lleva al Swagger generado por la OpenAPI vigente. El redirect es
  // temporal para no cachear para siempre este destino de transición.
  async redirects() {
    return [
      { source: "/docs", destination: DOCS_URL, permanent: false },
      { source: "/docs/:path*", destination: DOCS_URL, permanent: false },
    ]
  },
}

const withMDX = createMDX({})

export default withMDX(nextConfig)

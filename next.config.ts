import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare"
import createMDX from "@next/mdx"
import { withSentryConfig } from "@sentry/nextjs/config"
import type { NextConfig } from "next"

import { DOCS_URL } from "./lib/site-config"

// Permite acceder a bindings de Cloudflare durante `next dev`.
initOpenNextCloudflareForDev()

const nextConfig: NextConfig = {
  // Los dominios reservados de ngrok migraron de `.ngrok-free.app` a
  // `.ngrok-free.dev`. Sin el `.dev`, el guard de Next bloquea con 403 todo
  // `/_next` y `/__nextjs` que venga por el túnel — incluido el websocket de
  // HMR, que queda reconectando en bucle.
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.dev",
  ],
  // En el servidor, `@sentry/nextjs` resuelve al build `edge` del SDK. El de
  // Node arrastra OpenTelemetry y Turbopack lo mete dos veces (capa de route
  // handlers y capa SSR): +1 MB gzip al Worker, que lo pasaba del techo de
  // `check:bundle`. El Worker es workerd, no Node, y el build `edge` es
  // justamente el que el paquete exporta para la condición `workerd`; lo que
  // pasa es que Turbopack compila el servidor como Node y nunca la aplica.
  turbopack: {
    resolveAlias: {
      "@sentry/nextjs": {
        browser: "./node_modules/@sentry/nextjs/build/esm/index.client.js",
        default: "./node_modules/@sentry/nextjs/build/esm/edge/index.js",
      },
    },
  },
  // MDX sigue habilitado como extensión de página para futuros contenidos.
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],

  // Los docs se construyen en otro repo y se publican en docs.resender.dev.
  // El 301 (en vez de borrar la ruta a secas) conserva la autoridad de
  // /docs, que ya está indexada, y no deja 404 a quien tenga el link viejo.
  async redirects() {
    return [
      { source: "/docs", destination: DOCS_URL, permanent: true },
      { source: "/docs/:path*", destination: DOCS_URL, permanent: true },
      // `/messages` pasó a ser `/inbox` cuando la pantalla dejó de ser solo
      // DMs. El 308 (Next no usa 301: preserva el método) mantiene vivos los
      // enlaces guardados y el histórico de PostHog. Los query values viajan
      // solos, así que un `/messages?conversation=…` compartido sigue abriendo
      // la misma conversación.
      { source: "/messages", destination: "/inbox", permanent: true },
    ]
  },
}

const withMDX = createMDX({})

// La subida de source maps se activa sola cuando el build tiene
// `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` y `SENTRY_PROJECT`; sin ellos el build sigue
// igual y los stack traces de producción salen minificados.
export default withSentryConfig(withMDX(nextConfig), {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  // Los eventos del navegador salen por el propio dominio para que los
  // bloqueadores de anuncios no los tiren.
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
})

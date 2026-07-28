import fs from "node:fs"
import path from "node:path"

import { SITE_NAME } from "@/lib/site-config"

// Tarjeta social compartida por todas las rutas `opengraph-image.tsx`.
//
// Satori (el motor de `next/og`) NO soporta woff2, solo ttf/otf/woff — por eso
// en app/fonts/ conviven las dos variantes: woff2 para el sitio (next/font) y
// woff para esto. Las imágenes se generan en build (todas las rutas que las
// usan son SSG), así que leer del filesystem acá nunca corre en el worker.

export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = "image/png"

// Paleta de marca — espejo de :root en packages/ui/src/styles/globals.css.
const COLORS = {
  background: "#f3ece0",
  foreground: "#242029",
  primary: "#7773a5",
  muted: "#ebe4d6",
  mutedForeground: "#6b6780",
  border: "#d4cfc7",
}

function readFont(file: string) {
  return fs.readFileSync(path.join(process.cwd(), "app", "fonts", file))
}

export function ogFonts() {
  return [
    { name: "HK Grotesk", data: readFont("HKGroteskPro-Medium.woff"), weight: 500 as const, style: "normal" as const },
    { name: "HK Grotesk", data: readFont("HKGroteskPro-Bold.woff"), weight: 700 as const, style: "normal" as const },
  ]
}

export function OgCard({
  kicker,
  title,
  subtitle,
}: {
  kicker: string
  title: string
  subtitle?: string
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: COLORS.background,
        // Satori renderiza los radial-gradient como un manchón, así que el
        // acento de marca va como barra sólida en el borde izquierdo.
        borderLeft: `16px solid ${COLORS.primary}`,
        padding: "72px 80px",
        fontFamily: "HK Grotesk",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 500,
            color: COLORS.primary,
          }}
        >
          <span style={{ color: COLORS.mutedForeground }}>{"// "}</span>
          {kicker}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: title.length > 60 ? 62 : 76,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: COLORS.foreground,
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 32,
              fontWeight: 500,
              lineHeight: 1.4,
              color: COLORS.mutedForeground,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: `2px solid ${COLORS.border}`,
          paddingTop: 32,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 40,
            fontWeight: 700,
            color: COLORS.foreground,
          }}
        >
          {SITE_NAME}
          <span style={{ color: COLORS.primary }}>.dev</span>
        </div>
      </div>
    </div>
  )
}

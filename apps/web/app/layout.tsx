import type { Metadata } from "next"
import { Inter, Space_Mono } from "next/font/google"
import localFont from "next/font/local"

import "@workspace/ui/globals.css"
import { PostHogProvider } from "@/components/posthog-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@workspace/ui/lib/utils"
import { SITE_LEGAL_NAME, SITE_NAME, SITE_URL } from "@/lib/site-config"

// Body: Inter (default de shadcn). Código y ".dev" del logo: Space Mono.
const fontSans = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
})

// Headings y logo "Resender": HK Grotesk Pro (fuente local de marca).
const fontHeading = localFont({
  variable: "--font-hk",
  src: [
    { path: "./fonts/HKGroteskPro-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/HKGroteskPro-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/HKGroteskPro-Bold.woff2", weight: "700", style: "normal" },
  ],
})

// Base para resolver los `alternates`/`openGraph` relativos que declara cada
// página (ver lib/seo.ts). Sin esto Next los resuelve contra localhost.
//
// `title.default` no es decorativo: sin él, toda página que no exporte metadata
// propia se sirve SIN `<title>` (era el caso de /login y /register). El template
// evita repetir la marca a mano en cada página.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — La API relay para mensajes de Facebook`,
    template: `%s — ${SITE_NAME}`,
  },
  description:
    "Recibe mensajes de Facebook en tu webhook y responde por API. La alternativa developer-first a ManyChat, desde $15/mes.",
  applicationName: SITE_NAME,
  authors: [{ name: SITE_LEGAL_NAME }],
  creator: SITE_LEGAL_NAME,
  publisher: SITE_LEGAL_NAME,
  openGraph: {
    siteName: SITE_NAME,
    type: "website",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
  },
}

// `lang="es"` es el idioma por defecto del sitio (el español vive en la raíz).
// Las vistas bajo /en montan <HtmlLang lang="en" /> para corregirlo en cliente;
// el SEO por idioma lo llevan los hreflang del metadata, que son server-side.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={cn(
        "font-sans antialiased",
        fontSans.variable,
        fontMono.variable,
        fontHeading.variable
      )}
    >
      <body>
        {/* PostHogProvider va por fuera para que cualquier componente cliente
            del árbol alcance `usePostHog()`. El init no vive aquí: lo hace
            `instrumentation-client.ts` antes de la hidratación. */}
        <PostHogProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}

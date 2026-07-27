import type { Metadata } from "next"
import { Inter, Space_Mono } from "next/font/google"
import localFont from "next/font/local"

import "@workspace/ui/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@workspace/ui/lib/utils"

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
export const metadata: Metadata = {
  metadataBase: new URL("https://resender.dev"),
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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}

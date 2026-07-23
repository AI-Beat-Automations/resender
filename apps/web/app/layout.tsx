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

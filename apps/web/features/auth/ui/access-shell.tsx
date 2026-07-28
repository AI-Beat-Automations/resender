import Link from "next/link"
import type { ReactNode } from "react"

import { SiteLogo } from "@/components/site-logo"
import { cn } from "@workspace/ui/lib/utils"

// Chrome compartido de las cinco pantallas de acceso (login, registro,
// waitlist, activación de la suscripción y elección de plan). Ninguna lleva
// sidebar: viven fuera del grupo `(product)` y se dibujan como una tarjeta
// centrada sobre la crema, con topbar de wordmark y pie legal compacto.

type AccessShellProps = {
  children: ReactNode
  // Zona derecha del topbar: enlace a documentación o botón de cerrar sesión.
  topbarEnd?: ReactNode
}

export function AccessShell({ children, topbarEnd }: AccessShellProps) {
  return (
    <div className="flex min-h-svh flex-col bg-background bg-[radial-gradient(circle_at_top_left,var(--muted),transparent_38rem)]">
      <header className="flex items-center justify-between px-10 py-7">
        <SiteLogo />
        {topbarEnd}
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-10 pb-15">
        {children}
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-3.5 px-10 pb-7 font-mono text-[11px] text-[var(--text-subtle)]">
        <span>© {new Date().getFullYear()} AI Beat · Resender</span>
        <span aria-hidden>·</span>
        <Link href="/privacy" className="underline-offset-4 hover:underline">
          Privacidad
        </Link>
        <span aria-hidden>·</span>
        <Link href="/terms" className="underline-offset-4 hover:underline">
          Términos
        </Link>
      </footer>
    </div>
  )
}

// Enlace por defecto del topbar en las pantallas sin sesión abierta.
export function AccessDocsLink() {
  return (
    <Link
      href="/docs"
      className="text-[13.5px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
    >
      Documentación
    </Link>
  )
}

// Tarjeta de acceso. El ancho y el padding los fija cada pantalla porque la
// spec usa 400 px (login), 380 px (registro) y 520 px (waitlist/activación).
export function AccessCard({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        "w-full rounded-xl bg-card p-7 shadow-[var(--ring-hairline),var(--shadow-sm)]",
        className
      )}
    >
      {children}
    </section>
  )
}

// Eyebrow mono. El prefijo `// ` lo pone el componente para que las páginas
// no escriban un literal que ESLint confunde con un comentario JSX.
export function AccessEyebrow({ label }: { label: string }) {
  return (
    <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-subtle)]">
      {`// ${label}`}
    </p>
  )
}

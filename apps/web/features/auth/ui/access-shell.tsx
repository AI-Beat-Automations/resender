import Link from "next/link"
import type { ReactNode } from "react"

import { SiteLogo } from "@/components/site-logo"
import { getDictionary, localePath, type Locale } from "@/content/i18n"
import { cn } from "@workspace/ui/lib/utils"

// Chrome compartido de las cuatro pantallas de acceso (login, registro,
// elección de plan y activación de la suscripción). Ninguna lleva sidebar:
// viven fuera del grupo `(product)` y se dibujan como una tarjeta centrada
// sobre la crema, con topbar de wordmark y pie legal compacto. Eran cinco: la
// quinta era la pantalla autenticada del gate de acceso en `/waitlist`, que la
// ADR 0007 reemplazó por la lista de espera pública, que es una página de
// marketing y usa el chrome del sitio.

// `lang` solo lo pasan login y registro, que sí tienen gemela en /en (ADR
// 0006). Las otras dos pantallas son español-only y usan el valor por
// defecto. Las páginas legales no tienen gemela en inglés, así que sus enlaces
// apuntan siempre a la raíz: traducir la etiqueta es todo lo que se puede.
type AccessShellProps = {
  children: ReactNode
  // Zona derecha del topbar: enlace a documentación o botón de cerrar sesión.
  topbarEnd?: ReactNode
  lang?: Locale
}

export function AccessShell({
  children,
  topbarEnd,
  lang = "es",
}: AccessShellProps) {
  const t = getDictionary(lang).footer.links

  return (
    <div className="flex min-h-svh flex-col bg-background bg-[radial-gradient(circle_at_top_left,var(--muted),transparent_38rem)]">
      <header className="flex items-center justify-between px-10 py-7">
        <SiteLogo href={localePath("/", lang)} />
        {topbarEnd}
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-10 pb-15">
        {children}
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-3.5 px-10 pb-7 font-mono text-[11px] text-[var(--text-subtle)]">
        <span>
          © {new Date().getFullYear()} Lorna Suriano Hernandez · Resender
        </span>
        <span aria-hidden>·</span>
        <Link href="/privacy" className="underline-offset-4 hover:underline">
          {t.privacy}
        </Link>
        <span aria-hidden>·</span>
        <Link href="/terms" className="underline-offset-4 hover:underline">
          {t.terms}
        </Link>
      </footer>
    </div>
  )
}

// Enlace por defecto del topbar en las pantallas sin sesión abierta.
export function AccessDocsLink({ lang = "es" }: { lang?: Locale }) {
  return (
    <Link
      href="/docs"
      className="text-[13.5px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
    >
      {getDictionary(lang).footer.links.docs}
    </Link>
  )
}

// Tarjeta de acceso. El ancho y el padding los fija cada pantalla porque la
// spec usa 400 px (login), 380 px (registro) y 520 px (activación de la
// suscripción).
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

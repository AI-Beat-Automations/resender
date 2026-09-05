import Link from "next/link"
import type { ReactNode } from "react"

import { SiteLogo } from "@/components/site-logo"
import { getDictionary, localePath, type Locale } from "@/content/i18n"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

// Chrome compartido de las pantallas de acceso (login, registro, recuperación,
// lista de espera, elección de plan y activación de la suscripción). Ninguna
// lleva sidebar: viven fuera del grupo `(product)` y se dibujan como una
// tarjeta centrada sobre la superficie hundida (mocks `1b`–`1d`, ADR 0015),
// con topbar de wordmark y pie legal compacto.

// `lang` solo lo pasan login y registro, que sí tienen gemela en /en (ADR
// 0006). Las otras pantallas son español-only y usan el valor por defecto. Las
// páginas legales no tienen gemela en inglés, así que sus enlaces apuntan
// siempre a la raíz: traducir la etiqueta es todo lo que se puede.
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
    <div className="flex min-h-svh flex-col bg-surface-sunken">
      <header className="flex items-center justify-between px-7 py-4">
        <SiteLogo href={localePath("/", lang)} />
        {topbarEnd}
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-7 pb-10">
        {children}
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-3.5 px-7 pb-6 font-mono text-[11px] text-[var(--text-subtle)]">
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

// Tarjeta de acceso sobre `Card`: 400 px y 28 px de padding como en el mock
// (`--card-spacing` es la variable que `Card` usa para padding y gap). La
// cabecera va centrada en login/registro y alineada al inicio en las pantallas
// con icono (`/pending`, `/billing/success`), que la pasan por `header`.
export function AccessCard({
  className,
  eyebrow,
  title,
  description,
  header,
  align = "center",
  children,
}: {
  className?: string
  eyebrow?: string
  title: string
  description?: ReactNode
  /** Contenido previo al título dentro de la cabecera (icono, alerta). */
  header?: ReactNode
  align?: "center" | "start"
  children?: ReactNode
}) {
  return (
    <Card
      className={cn(
        "w-full max-w-100 gap-4.5 [--card-spacing:--spacing(7)]",
        className
      )}
    >
      <CardHeader
        className={cn("gap-1.5", align === "center" && "text-center")}
      >
        {header}
        {eyebrow ? <AccessEyebrow label={eyebrow} /> : null}
        <h1 className="font-heading text-[22px] font-bold tracking-tight">
          {title}
        </h1>
        {description ? (
          <CardDescription className="text-[13.5px]/[1.6]">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      {children ? (
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      ) : null}
    </Card>
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

// Enlace bajo la tarjeta («¿No tienes cuenta? Crear una» / «¿Ya tienes
// cuenta? Iniciar sesión»), fuera de la card como en `1b`/`1c`.
export function AccessSwitchLink({
  lang,
  mode,
}: {
  lang: Locale
  mode: "login" | "register"
}) {
  const t = getDictionary(lang).auth.form
  const isLogin = mode === "login"

  return (
    <p className="text-center text-[13.5px] text-muted-foreground">
      {isLogin ? t.noAccount : t.haveAccount}{" "}
      <Link
        href={localePath(isLogin ? "/register" : "/login", lang)}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        {isLogin ? t.signUp : t.signInAction}
      </Link>
    </p>
  )
}

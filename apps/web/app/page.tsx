import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

export default function Page() {
  return (
    <main className="min-h-svh bg-[radial-gradient(circle_at_top_left,theme(colors.muted),transparent_34rem)]">
      <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Echo
          </Link>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost">
              <Link href="/login">Login</Link>
            </Button>
            <Button asChild>
              <Link href="/register">Register</Link>
            </Button>
          </nav>
        </header>

        <section className="grid flex-1 items-center gap-10 py-20 md:grid-cols-[1.1fr_0.9fr]">
          <div className="max-w-2xl">
            <p className="mb-4 text-sm font-medium text-muted-foreground">
              Gateway + bitacora para Messenger
            </p>
            <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
              Recibe mensajes de Facebook y responde desde tu automatizacion.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Echo conecta tus paginas, guarda cada conversacion y entrega los
              mensajes a tu sistema externo con credenciales revocables.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/register">Crear cuenta</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Ya tengo cuenta</Link>
              </Button>
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
            <div className="rounded-2xl bg-muted p-4">
              <div className="mb-5 flex items-center justify-between text-xs text-muted-foreground">
                <span>Mensaje entrante</span>
                <span>persistido</span>
              </div>
              <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-950 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-100">
                Hola, quiero saber si tienen disponibilidad para hoy.
              </div>
              <div className="my-4 h-px bg-border" />
              <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-950 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-100">
                Tu automatizacion responde por la API segura de Echo.
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

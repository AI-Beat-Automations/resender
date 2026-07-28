import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { SiteBackground } from "@/components/site-background"
import { getDictionary } from "@/content/i18n"

// 404 propio. Antes salía el default de Next: sin header, sin footer y sin un
// solo enlace interno, así que cualquier crawler (o persona) que cayera acá
// llegaba a un callejón sin salida.
//
// En español porque el root layout es `lang="es"`; `not-found.tsx` se resuelve
// fuera del árbol de rutas y no tiene forma de saber el idioma de origen.
export const metadata = {
  title: "Página no encontrada",
  robots: { index: false, follow: true },
}

const dict = getDictionary("es")

export default function NotFound() {
  const links = [
    { href: "/", label: "Inicio" },
    { href: "/pricing", label: dict.footer.links.pricing },
    { href: "/vs-manychat", label: dict.footer.links.vsManychat },
    { href: "/blog", label: dict.footer.links.blog },
  ]

  return (
    <div className="light flex min-h-svh flex-col">
      <SiteBackground />
      <SiteHeader lang="es" />
      <main className="flex flex-1 items-center">
        <div className="mx-auto w-full max-w-2xl px-6 py-24 text-center">
          <p className="font-mono text-sm text-primary">
            <span className="text-muted-foreground">{"// "}</span>
            404
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            Esta página no existe
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Puede que el enlace esté roto o que la página haya cambiado de
            dirección.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {links.map((link) => (
              <Button key={link.href} asChild variant="outline">
                <Link href={link.href}>{link.label}</Link>
              </Button>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter lang="es" />
    </div>
  )
}

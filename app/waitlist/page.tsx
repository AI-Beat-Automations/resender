import type { Metadata } from "next"

import { WaitlistView } from "@/features/marketing/views/waitlist-view"
import { getDictionary } from "@/content/i18n"
import { alternatesFor, openGraphFor } from "@/lib/seo"

const dict = getDictionary("es")

// Esta ruta era la pantalla autenticada del gate de acceso. La ADR 0007 apagó
// el gate y le dio la URL a la lista de espera pública: sin `auth()`, sin
// `redirect` y sin `privatePageMetadata`, porque ahora es una página de
// marketing indexable con gemela en inglés.
export const metadata: Metadata = {
  title: dict.meta.waitlist.title,
  description: dict.meta.waitlist.description,
  alternates: alternatesFor("/waitlist", "es"),
  openGraph: openGraphFor({
    title: dict.meta.waitlist.ogTitle,
    description: dict.meta.waitlist.ogDescription,
    lang: "es",
  }),
}

export default function WaitlistPage() {
  return <WaitlistView lang="es" />
}

import Link from "next/link"

import type { AppDict } from "@/content/i18n/app"
import {
  whatsappTemplatesHref,
  type WhatsappNumberOption,
} from "@/lib/whatsapp-templates/template-console"
import { Badge } from "@workspace/ui/components/badge"

// Selector del número cuyo catálogo se está mirando.
//
// Son enlaces y no un control con estado, como el filtro por cuenta del Inbox:
// el número seleccionado vive en la URL, así que la pantalla entera sigue siendo
// server component y un catálogo concreto se puede compartir o recargar.
//
// La pantalla se direcciona **por número** aunque la [Plantilla] viva en la
// WABA: toda la superficie del producto es orientada al número —la API pública
// también— y la WABA se resuelve del lado del servidor. Dos números de la misma
// WABA muestran el mismo catálogo, que es la verdad y no un error de esta
// pantalla (ADR 0014).

export function TemplatesNumberFilter({
  numbers,
  selectedPageId,
  t,
}: {
  numbers: WhatsappNumberOption[]
  selectedPageId: string
  t: AppDict
}) {
  // Con un solo número no hay nada que elegir: una fila con una única píldora
  // siempre activa es un control muerto que además sugiere que falta algo.
  if (numbers.length < 2) return null

  return (
    <div
      className="mt-3.5 flex flex-wrap gap-2"
      role="group"
      aria-label={t.templates.numberFilterLabel}
    >
      {numbers.map((number) => {
        const active = number.pageId === selectedPageId

        return (
          <Badge
            key={number.pageId}
            asChild
            variant={active ? "default" : "outline"}
            className="h-6 px-3"
          >
            <Link
              href={whatsappTemplatesHref(number.pageId)}
              aria-current={active ? "page" : undefined}
            >
              {number.label}
            </Link>
          </Badge>
        )
      })}
    </div>
  )
}

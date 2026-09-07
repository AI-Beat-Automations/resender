import { Mail } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"

import { getDictionary, type Locale } from "@/content/i18n"
import { SITE_CONTACT_EMAIL, SITE_CONTACT_EMAIL_HREF } from "@/lib/site-config"

// Banda «a medida» debajo de las tres cards de /pricing. No es un cuarto plan
// con precio: es la salida para organizaciones que superan Business (más
// volumen, más conexiones o condiciones propias). Un solo camino, el correo:
// es el canal serio para este tipo de conversación.
export function EnterpriseCta({ lang }: { lang: Locale }) {
  const dict = getDictionary(lang).pricing.enterprise
  // La descripción trae `{email}` en el copy; lo partimos para renderizar el
  // correo como enlace en medio de la frase.
  const [before, after] = dict.description.split("{email}")

  return (
    <Card className="mx-auto max-w-5xl border-dashed py-0">
      <CardContent className="flex flex-col gap-6 p-8 md:flex-row md:items-center md:justify-between md:p-10">
        <div className="max-w-xl">
          <h3 className="font-heading text-2xl font-bold tracking-tight">
            {dict.title}
          </h3>
          <p className="mt-2 text-muted-foreground">
            {before}
            <a
              href={SITE_CONTACT_EMAIL_HREF}
              className="font-medium text-foreground underline underline-offset-4"
            >
              {SITE_CONTACT_EMAIL}
            </a>
            {after}
          </p>
        </div>
        <Button asChild variant="outline" className="shrink-0 self-start md:self-auto">
          <a href={SITE_CONTACT_EMAIL_HREF}>
            <Mail className="size-4" />
            {SITE_CONTACT_EMAIL}
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}

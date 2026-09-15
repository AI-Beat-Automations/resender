"use client"

import * as React from "react"

// El root layout es único para todo el sitio y declara `lang="es"`. Las vistas
// bajo /en montan este componente para corregir el atributo en cliente. El SEO
// por idioma no depende de esto: lo llevan los `hreflang` del metadata, que se
// generan server-side.
export function HtmlLang({ lang }: { lang: string }) {
  React.useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  return null
}

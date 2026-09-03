import { cookies } from "next/headers"

import { defaultLocale, type Locale } from "@/content/i18n"
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/locale-cookie"

// Idioma de los correos del #98 ([Verificacion de correo] y el aviso de
// [Cuenta vinculada]). Es distinto del truco de `sendResetPassword`, que lo
// deduce del `callbackURL`: acá el `callbackURL` es `/pending` o
// `/connections`, rutas del producto que **no tienen gemela `/en`** y por lo
// tanto no codifican idioma. Lo que sí lo codifica es la cookie `lang`
// (`LOCALE_COOKIE`, la misma que leen `resolveAppLocale` y el switch del sitio;
// **no** existe ninguna `NEXT_LOCALE`).
//
// Tres fuentes, en orden:
//   1. El header `cookie` del `request` que la librería le pasa al callback.
//      Es el camino del callback de Google y del `GET` de verificación, donde
//      la llamada entró por HTTP a `/api/auth/*` y `next/headers` no aplica.
//   2. `cookies()` de Next, para cuando la llamada nace en un server action
//      (`signUpEmail`, el reenvío desde `/pending` o Settings): ahí no hay
//      `request` en el contexto de la librería, pero sí hay async-context de
//      Next. Va en `try/catch` porque fuera de una request —vitest, un script—
//      `cookies()` lanza.
//   3. `es`, el idioma por defecto del producto.

/** Función pura: el parser del header `cookie`, que es lo testeable. */
export function localeFromCookieHeader(
  header: string | null | undefined
): Locale | null {
  if (!header) return null
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== LOCALE_COOKIE) continue
    let value = part.slice(eq + 1).trim()
    try {
      value = decodeURIComponent(value)
    } catch {
      // Un valor mal codificado no es un idioma: se sigue buscando.
      continue
    }
    if (isLocale(value)) return value
  }
  return null
}

async function localeFromNextCookies(): Promise<Locale | null> {
  try {
    const value = (await cookies()).get(LOCALE_COOKIE)?.value
    return isLocale(value) ? value : null
  } catch {
    return null
  }
}

export async function resolveEmailLocale(
  request?: Request | null
): Promise<Locale> {
  const fromRequest = localeFromCookieHeader(request?.headers.get("cookie"))
  if (fromRequest) return fromRequest

  return (await localeFromNextCookies()) ?? defaultLocale
}

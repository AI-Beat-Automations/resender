import { cookies } from "next/headers"

import { defaultLocale, type Locale } from "@/content/i18n"

import { LOCALE_COOKIE, isLocale } from "./locale-cookie"

// Idioma de la app logueada. A diferencia del sitio público —donde el idioma ES
// el path (`/` vs `/en`)—, el dashboard lleva `noindex` y no tiene gemela por
// idioma: no hay nada que indexar ni que enlazar con hreflang, así que prefijar
// sus URLs sería superficie de ruteo sin contrapartida.
//
// Server-only: importa `next/headers`. Las constantes de la cookie viven en
// `./locale-cookie`, que sí puede importar el cliente.
export { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from "./locale-cookie"

/**
 * El idioma de esta petición. La cookie es entrada del usuario, no un contrato:
 * cualquier valor que no sea un idioma conocido cae en el de por defecto, igual
 * que hace `resolveSettingsTab` con `?tab=`.
 */
export async function resolveAppLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value
  return isLocale(value) ? value : defaultLocale
}

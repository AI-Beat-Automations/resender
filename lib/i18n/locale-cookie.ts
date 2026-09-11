import { locales, type Locale } from "@/content/i18n"

// La cookie del idioma de la consola, **sin Next adentro**. Vive aparte de
// `app-locale.ts` porque a esa la lastra `next/headers`, y esto lo necesita
// también el switch del sitio público, que es un componente cliente: importarlo
// del otro módulo arrastraría `cookies()` al bundle del navegador.
//
// El idioma viaja en cookie y no en `users`: es una preferencia de lectura, no
// un dato de la cuenta. La escriben el switch del sitio (para que quien llegó
// por `/en/register` entre al producto en inglés) y el selector de Ajustes, que
// es el único control disponible una vez dentro de la sesión.
export const LOCALE_COOKIE = "lang"

// Un año: la preferencia no caduca sola, la cambia el usuario.
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale)
}

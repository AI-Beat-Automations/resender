"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"

import type { Locale } from "@/content/i18n"
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
} from "@/lib/i18n/app-locale"

// El único control de idioma que hay una vez dentro de la sesión. El switch del
// sitio público no sirve acá: depende de `hasLocaleTwin(pathname)`, y las
// pantallas del producto no tienen gemela en `/en` a propósito (llevan
// `noindex`; no hay nada que indexar ni que enlazar con hreflang).
//
// Escribe la misma cookie que el switch del sitio, así que cruzar de `/en` al
// producto y cambiar el idioma desde Ajustes son la misma preferencia y no dos.
export async function setAppLocaleAction(formData: FormData): Promise<void> {
  const value = formData.get("locale")
  // Entrada del usuario, no un contrato: un `locale` inventado no cambia nada
  // en vez de dejar la cookie con basura que luego hay que sanear al leerla.
  if (!isLocale(value)) return

  const store = await cookies()
  store.set(LOCALE_COOKIE, value satisfies Locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    // No es un secreto y el switch del sitio público la escribe desde el
    // cliente: marcarla `httpOnly` acá dejaría los dos controles peleándose por
    // la misma cookie.
    httpOnly: false,
  })

  // El idioma se resuelve en el layout de `(product)`, así que hay que
  // revalidar el layout entero y no solo la pantalla de Ajustes: si no, el
  // sidebar y la franja de cuota se quedan en el idioma anterior.
  revalidatePath("/", "layout")
}

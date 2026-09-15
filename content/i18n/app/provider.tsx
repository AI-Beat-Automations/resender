"use client"

import { createContext, useContext, type ReactNode } from "react"

import type { Locale } from "@/content/i18n"

import type { AppDict } from "./dictionary"

// El diccionario del producto para los componentes cliente. El layout lo
// resuelve una sola vez en el servidor y lo baja entero: es serializable (solo
// strings), así que cruza el borde sin ceremonia y sin obligar a cada pantalla
// a enhebrar props idioma abajo.
//
// No lo importan directo con `getAppDictionary(lang)` porque eso metería los
// dos idiomas en el bundle del cliente; así viaja solo el que se está usando.

type AppI18n = { lang: Locale; t: AppDict }

const AppI18nContext = createContext<AppI18n | null>(null)

export function AppI18nProvider({
  lang,
  dict,
  children,
}: {
  lang: Locale
  dict: AppDict
  children: ReactNode
}) {
  return <AppI18nContext value={{ lang, t: dict }}>{children}</AppI18nContext>
}

export function useAppI18n(): AppI18n {
  const value = useContext(AppI18nContext)
  if (!value) {
    throw new Error("useAppI18n fuera de <AppI18nProvider>")
  }
  return value
}

/** Azúcar para el caso común: solo el diccionario. */
export function useAppDict(): AppDict {
  return useAppI18n().t
}

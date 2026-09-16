import type { SettingsTab } from "@/lib/settings/settings-tabs"

export type SettingsDict = {
  eyebrow: string
  title: string
  subtitle: string
  tabs: Record<SettingsTab, string>
  tabsAria: string
  /**
   * Nota de la pestaña Cuenta de un cliente (issue #154): quién administra
   * su acceso. `{owner}` es el nombre del padre, o su correo si no tiene.
   */
  managedBy: string
  language: {
    title: string
    body: string
    label: string
    es: string
    en: string
  }
}

export const es: SettingsDict = {
  eyebrow: "ajustes",
  title: "Ajustes",
  subtitle: "Administra tu cuenta y las API keys de integración externa.",
  tabs: {
    cuenta: "Cuenta",
    "api-keys": "API keys",
    suscripcion: "Suscripción",
  },
  tabsAria: "Secciones de ajustes",
  managedBy: "Tu acceso lo administra {owner}.",
  language: {
    title: "Idioma",
    body: "El idioma de la consola. No cambia el idioma de la API ni el de los correos de Meta.",
    label: "Idioma de la consola",
    es: "Español",
    en: "Inglés",
  },
}

export const en: SettingsDict = {
  eyebrow: "settings",
  title: "Settings",
  subtitle: "Manage your account and the API keys for external integration.",
  tabs: {
    cuenta: "Account",
    "api-keys": "API keys",
    suscripcion: "Subscription",
  },
  tabsAria: "Settings sections",
  managedBy: "Your access is managed by {owner}.",
  language: {
    title: "Language",
    body: "The language of the console. It doesn't change the API's language or the language of Meta's emails.",
    label: "Console language",
    es: "Spanish",
    en: "English",
  },
}

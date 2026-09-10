// La pestaña activa de Ajustes vive en la URL, no en estado de React
// (ADR 0005): la franja de aviso de cuota enlaza a `/settings?tab=suscripcion`,
// y con estado en memoria un usuario bloqueado aterrizaría en Cuenta, viendo su
// email y un botón de borrar su cuenta. Módulo puro: sin React, sin Next.

export type SettingsTab = "cuenta" | "api-keys" | "suscripcion"

export const DEFAULT_SETTINGS_TAB: SettingsTab = "cuenta"

// Orden de las tres pestañas; la UI lo lee de aquí en vez de redeclararlo. La
// **etiqueta** vive en `t.settings.tabs`, que es un `Record<SettingsTab,
// string>`: el id es contrato de URL —la franja de cuota enlaza a
// `/settings?tab=suscripcion`— y por eso sigue en español aunque la etiqueta se
// traduzca.
export const SETTINGS_TABS: readonly SettingsTab[] = [
  "cuenta",
  "api-keys",
  "suscripcion",
]

export function isSettingsTab(value: unknown): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab === value)
}

// `searchParams` de Next puede entregar `string`, `string[]` (`?tab=a&tab=b`)
// o `undefined`. El parámetro es entrada del usuario, no un contrato: cualquier
// valor que no sea una pestaña conocida cae en la de por defecto.
export function resolveSettingsTab(
  param: string | string[] | undefined
): SettingsTab {
  const value = Array.isArray(param) ? param[0] : param
  return isSettingsTab(value) ? value : DEFAULT_SETTINGS_TAB
}

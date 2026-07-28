// La pestaña activa de Ajustes vive en la URL, no en estado de React
// (ADR 0005): la franja de aviso de cuota enlaza a `/settings?tab=suscripcion`,
// y con estado en memoria un usuario bloqueado aterrizaría en Cuenta, viendo su
// email y un botón de borrar su cuenta. Módulo puro: sin React, sin Next.

export type SettingsTab = "cuenta" | "api-keys" | "suscripcion"

export type SettingsTabDescriptor = {
  id: SettingsTab
  label: string
}

export const DEFAULT_SETTINGS_TAB: SettingsTab = "cuenta"

// Orden y etiqueta visible de las tres pestañas; la UI las lee de aquí en vez
// de redeclararlas.
export const SETTINGS_TABS: readonly SettingsTabDescriptor[] = [
  { id: "cuenta", label: "Cuenta" },
  { id: "api-keys", label: "API keys" },
  { id: "suscripcion", label: "Suscripción" },
]

export function isSettingsTab(value: unknown): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.id === value)
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

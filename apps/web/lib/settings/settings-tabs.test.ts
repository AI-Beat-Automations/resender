import { describe, expect, it } from "vitest"

import {
  DEFAULT_SETTINGS_TAB,
  resolveSettingsTab,
  SETTINGS_TABS,
} from "./settings-tabs"

describe("settings tab resolution", () => {
  it("falls back to Cuenta when the parameter is missing", () => {
    expect(resolveSettingsTab(undefined)).toBe("cuenta")
    expect(resolveSettingsTab(undefined)).toBe(DEFAULT_SETTINGS_TAB)
  })

  it("falls back to Cuenta for an unknown value", () => {
    expect(resolveSettingsTab("facturacion")).toBe(DEFAULT_SETTINGS_TAB)
    expect(resolveSettingsTab("")).toBe(DEFAULT_SETTINGS_TAB)
    expect(resolveSettingsTab("Cuenta")).toBe(DEFAULT_SETTINGS_TAB)
  })

  it("keeps every valid tab", () => {
    for (const tab of SETTINGS_TABS) {
      expect(resolveSettingsTab(tab.id)).toBe(tab.id)
    }
  })

  it("takes the first entry when Next hands over an array", () => {
    expect(resolveSettingsTab(["suscripcion", "cuenta"])).toBe("suscripcion")
    expect(resolveSettingsTab(["nope", "suscripcion"])).toBe(
      DEFAULT_SETTINGS_TAB
    )
    expect(resolveSettingsTab([])).toBe(DEFAULT_SETTINGS_TAB)
  })

  it("exposes the three tabs with their visible label", () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      "cuenta",
      "api-keys",
      "suscripcion",
    ])
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual([
      "Cuenta",
      "API keys",
      "Suscripción",
    ])
  })

  it("links from the quota notice bar land on the Subscription tab", () => {
    // `quota-notice-bar.tsx` manda a `/settings?tab=suscripcion`: si este
    // valor deja de ser válido, un usuario bloqueado aterriza en Cuenta.
    const tab = new URL("https://resender.dev/settings?tab=suscripcion")
    expect(resolveSettingsTab(tab.searchParams.get("tab") ?? undefined)).toBe(
      "suscripcion"
    )
  })
})

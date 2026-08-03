import { describe, expect, it } from "vitest"

import {
  hasLocaleTwin,
  localeFromPathname,
  localePath,
  switchLocalePath,
} from "./dictionary"

describe("localePath", () => {
  it("deja las rutas en español tal cual", () => {
    expect(localePath("/", "es")).toBe("/")
    expect(localePath("/pricing", "es")).toBe("/pricing")
    expect(localePath("/blog/mi-post", "es")).toBe("/blog/mi-post")
  })

  it("prefija con /en las rutas en inglés", () => {
    expect(localePath("/", "en")).toBe("/en")
    expect(localePath("/pricing", "en")).toBe("/en/pricing")
    expect(localePath("/blog/mi-post", "en")).toBe("/en/blog/mi-post")
  })
})

describe("localeFromPathname", () => {
  it("detecta inglés solo bajo /en", () => {
    expect(localeFromPathname("/en")).toBe("en")
    expect(localeFromPathname("/en/pricing")).toBe("en")
    expect(localeFromPathname("/")).toBe("es")
    expect(localeFromPathname("/pricing")).toBe("es")
  })

  it("no confunde rutas que solo empiezan con 'en'", () => {
    expect(localeFromPathname("/endpoints")).toBe("es")
  })
})

describe("hasLocaleTwin", () => {
  it("reconoce las rutas que existen en los dos idiomas", () => {
    for (const path of [
      "/",
      "/pricing",
      "/vs-manychat",
      "/en/vs-manychat",
      "/blog",
      "/blog/mi-post",
      "/login",
      "/register",
      "/waitlist",
      "/en/waitlist",
      "/en",
      "/en/blog/mi-post",
    ]) {
      expect(hasLocaleTwin(path)).toBe(true)
    }
  })

  it("descarta las rutas que viven solo en la raíz", () => {
    for (const path of [
      "/privacy",
      "/terms",
      "/data-deletion",
      "/billing",
      "/connections",
    ]) {
      expect(hasLocaleTwin(path)).toBe(false)
    }
  })
})

describe("switchLocalePath", () => {
  it("va de español a inglés", () => {
    expect(switchLocalePath("/", "en")).toBe("/en")
    expect(switchLocalePath("/pricing", "en")).toBe("/en/pricing")
    expect(switchLocalePath("/blog/mi-post", "en")).toBe("/en/blog/mi-post")
  })

  it("va de inglés a español", () => {
    expect(switchLocalePath("/en", "es")).toBe("/")
    expect(switchLocalePath("/en/pricing", "es")).toBe("/pricing")
    expect(switchLocalePath("/en/blog/mi-post", "es")).toBe("/blog/mi-post")
  })

  it("cruza la lista de espera en los dos sentidos", () => {
    // La /waitlist vieja era la pantalla autenticada del gate de acceso y no
    // tenía gemela; desde la ADR 0007 es una página pública bilingüe.
    expect(switchLocalePath("/waitlist", "en")).toBe("/en/waitlist")
    expect(switchLocalePath("/en/waitlist", "es")).toBe("/waitlist")
  })

  it("es idempotente si ya estás en el idioma destino", () => {
    expect(switchLocalePath("/en/pricing", "en")).toBe("/en/pricing")
    expect(switchLocalePath("/pricing", "es")).toBe("/pricing")
  })

  it("cae a la home del idioma cuando la ruta no está localizada", () => {
    // El header (y el switch) también se renderiza en las páginas legales, que
    // existen solo en español: /en/privacy sería un 404.
    expect(switchLocalePath("/privacy", "en")).toBe("/en")
    expect(switchLocalePath("/terms", "en")).toBe("/en")
    expect(switchLocalePath("/data-deletion", "en")).toBe("/en")
  })
})

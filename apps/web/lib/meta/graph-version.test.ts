import { afterEach, describe, expect, it, vi } from "vitest"

import {
  assertGraphVersion,
  GRAPH_FACEBOOK_BASE,
  GRAPH_FACEBOOK_HOST,
  GRAPH_INSTAGRAM_BASE,
  GRAPH_INSTAGRAM_HOST,
  META_GRAPH_VERSION,
} from "./graph-version"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("forma de la versión de Graph", () => {
  it("acepta una versión bien formada y la devuelve tal cual", () => {
    expect(assertGraphVersion("v23.0")).toBe("v23.0")
    expect(assertGraphVersion("v9.0")).toBe("v9.0")
    expect(assertGraphVersion("v100.12")).toBe("v100.12")
  })

  // Un valor mal escrito no rompe al arrancar: rompe en la primera llamada a
  // Meta, con un 404 de Graph que parece un problema de permisos o de id.
  it.each([
    ["23.0", "sin la v"],
    ["v23", "sin la menor"],
    ["v23.", "con el punto colgando"],
    ["latest", "una palabra"],
    [" v23.0", "con un espacio del copiar y pegar"],
    ["v23.0 ", "con un espacio al final"],
    ["v23.0/", "con la barra del path pegada"],
    ["", "vacía"],
  ])("rechaza %j (%s)", (value) => {
    expect(() => assertGraphVersion(value)).toThrowError(/META_GRAPH_VERSION/)
  })

  // El mensaje lleva el valor recibido: sin él, el error dice que algo está mal
  // pero no qué se leyó, que es justo el dato que cierra el diagnóstico.
  it("nombra el valor recibido en el error", () => {
    expect(() => assertGraphVersion("v-nueve")).toThrowError(/v-nueve/)
  })
})

describe("resolución desde el entorno", () => {
  it("cae al default cuando la variable no está", async () => {
    vi.stubEnv("META_GRAPH_VERSION", "")
    vi.resetModules()

    const reloaded = await import("./graph-version")
    expect(reloaded.META_GRAPH_VERSION).toBe("v23.0")
  })

  // La ventana entre «Meta depreció la versión» y «hay un deploy nuevo» se cubre
  // con una variable de entorno, no con un PR.
  it("usa la del entorno cuando está bien formada", async () => {
    vi.stubEnv("META_GRAPH_VERSION", "v24.0")
    vi.resetModules()

    const reloaded = await import("./graph-version")
    expect(reloaded.META_GRAPH_VERSION).toBe("v24.0")
    expect(reloaded.GRAPH_FACEBOOK_BASE).toBe(
      "https://graph.facebook.com/v24.0"
    )
    expect(reloaded.GRAPH_INSTAGRAM_BASE).toBe(
      "https://graph.instagram.com/v24.0"
    )
  })

  // Falla en el import, no en la primera llamada a Graph.
  it("revienta al importar si la del entorno es basura", async () => {
    vi.stubEnv("META_GRAPH_VERSION", "v-nueve")
    vi.resetModules()

    await expect(import("./graph-version")).rejects.toThrowError(
      /META_GRAPH_VERSION/
    )
  })
})

describe("hosts y bases", () => {
  // Los dos hosts no son intercambiables: el token de Instagram Login no sirve
  // contra el Graph de Facebook, y al revés tampoco.
  it("expone los dos hosts y sus bases versionadas", () => {
    expect(GRAPH_FACEBOOK_HOST).toBe("https://graph.facebook.com")
    expect(GRAPH_INSTAGRAM_HOST).toBe("https://graph.instagram.com")
    expect(GRAPH_FACEBOOK_BASE).toBe(
      `${GRAPH_FACEBOOK_HOST}/${META_GRAPH_VERSION}`
    )
    expect(GRAPH_INSTAGRAM_BASE).toBe(
      `${GRAPH_INSTAGRAM_HOST}/${META_GRAPH_VERSION}`
    )
  })
})

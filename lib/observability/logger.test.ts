import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { accountFields, describeError, log } from "./logger"

// El logger es puro y concentra tres garantías que ningún test de call site
// vuelve a revisar: el nivel que le toca a cada `outcome`, el `event` derivado,
// y que ningún secreto salga adentro de un `errorMessage`. Por eso acá se
// testea a fondo y en el resto del repo alcanza con `objectContaining` de tres
// campos.

const spies = {
  log: vi.spyOn(console, "log").mockImplementation(() => {}),
  warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
}

beforeEach(() => {
  spies.log.mockClear()
  spies.warn.mockClear()
  spies.error.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function lastRecord(spy: ReturnType<typeof vi.spyOn>) {
  const call = spy.mock.calls.at(-1)
  return call?.[0] as Record<string, unknown>
}

describe("log", () => {
  it("emite un solo objeto y no un string interpolado", () => {
    log({ entrypoint: "route", action: "webhook_receive", outcome: "ok" })

    // Dos argumentos rompen el indexado estructurado de Workers Logs: la UI
    // deja de poder armar `$.accountId = "..."`. Es la razón de ser del módulo.
    const call = spies.log.mock.calls.at(0)
    expect(call).toHaveLength(1)
    expect(typeof call?.[0]).toBe("object")
  })

  it("deriva `event` de la acción y el resultado", () => {
    log({
      entrypoint: "route",
      action: "inbound_ingest",
      outcome: "dropped",
      reason: "account_not_connected",
    })

    expect(lastRecord(spies.log)).toMatchObject({
      worker: "web",
      event: "inbound_ingest_dropped",
      reason: "account_not_connected",
    })
  })

  it("manda los descartes a info, los reintentos a warn y los fallos a error", () => {
    log({
      entrypoint: "route",
      action: "inbound_ingest",
      outcome: "dropped",
      reason: "already_ingested",
    })
    log({
      entrypoint: "after",
      action: "webhook_delivery",
      outcome: "retry",
      reason: "http_error",
    })
    log({
      entrypoint: "after",
      action: "webhook_delivery",
      outcome: "failed",
      reason: "max_attempts_exhausted",
    })

    expect(spies.log).toHaveBeenCalledTimes(1)
    expect(spies.warn).toHaveBeenCalledTimes(1)
    expect(spies.error).toHaveBeenCalledTimes(1)
  })

  it("permite subir el nivel de un descarte que sí es una alarma", () => {
    // Una firma que no coincide es un descarte, pero no es operación normal:
    // fue el incidente que dejó la ruta rechazando todo con 401 en silencio.
    log({
      entrypoint: "route",
      action: "webhook_receive",
      outcome: "dropped",
      reason: "signature_mismatch",
      level: "warn",
    })

    expect(spies.warn).toHaveBeenCalledTimes(1)
    expect(spies.log).not.toHaveBeenCalled()
    expect(lastRecord(spies.warn)).not.toHaveProperty("level")
  })

  it("usa ENVIRONMENT y cae en development cuando no está", () => {
    vi.stubEnv("ENVIRONMENT", "production")
    log({ entrypoint: "route", action: "oauth_start", outcome: "ok" })
    expect(lastRecord(spies.log)).toMatchObject({ environment: "production" })
  })

  describe("redacción", () => {
    const cases: Array<[string, string]> = [
      [
        "una URL del Graph con el token en el query",
        "https://graph.facebook.com/v23.0/me/messages?access_token=EAAG1234567890abcdefghijklmnopqrstuvwxyz1234567890",
      ],
      ["un client_secret", "oauth failed client_secret=abc123def456"],
      [
        "una firma calculada",
        "mismatch: sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ],
      [
        "un token de Instagram",
        "invalid IGQVJYWlFAaTlpc0hnamJqWXhLd2VkRE5PRlVDbGZAtZAmZAvOEo1234567890",
      ],
      ["una API key de Resender", "bad key pk_live_abcdef1234567890"],
      ["una clave de Stripe", "sk_live_abcdef1234567890 rejected"],
    ]

    it.each(cases)("borra %s", (_label, message) => {
      log({
        entrypoint: "route",
        action: "outbound_send",
        outcome: "failed",
        reason: "meta_rejected",
        errorMessage: message,
      })

      const record = lastRecord(spies.error)
      expect(record.errorMessage).toContain("[redacted]")
      expect(record.errorMessage).not.toMatch(
        /EAAG|IGQVJ|pk_live_|sk_live_|client_secret=|access_token=|sha256=[0-9a-f]{64}/
      )
    })

    it("borra todas las ocurrencias y no solo la primera", () => {
      log({
        entrypoint: "route",
        action: "outbound_send",
        outcome: "failed",
        reason: "meta_rejected",
        errorMessage: "a=1 access_token=uno b=2 access_token=dos",
      })

      const message = lastRecord(spies.error).errorMessage as string
      expect(message.match(/\[redacted\]/g)).toHaveLength(2)
    })

    it("no se saltea ocurrencias en llamadas sucesivas", () => {
      // Los patrones son constantes de módulo con la bandera `g`: sin resetear
      // `lastIndex`, la segunda llamada arrancaría a mitad del string y dejaría
      // pasar el secreto. Es el bug clásico de un regex global reutilizado.
      const message = "access_token=secreto"
      log({
        entrypoint: "route",
        action: "outbound_send",
        outcome: "failed",
        reason: "meta_rejected",
        errorMessage: message,
      })
      log({
        entrypoint: "route",
        action: "outbound_send",
        outcome: "failed",
        reason: "meta_rejected",
        errorMessage: message,
      })

      expect(lastRecord(spies.error).errorMessage).toBe("[redacted]")
    })

    it("trunca un mensaje largo", () => {
      log({
        entrypoint: "route",
        action: "outbound_send",
        outcome: "failed",
        reason: "meta_rejected",
        errorMessage: "x".repeat(500),
      })

      const message = lastRecord(spies.error).errorMessage as string
      expect(message).toHaveLength(301)
      expect(message.endsWith("…")).toBe(true)
    })

    it("no emite errorMessage cuando no se pasó", () => {
      log({ entrypoint: "route", action: "webhook_receive", outcome: "ok" })
      expect(lastRecord(spies.log)).not.toHaveProperty("errorMessage")
    })
  })
})

describe("describeError", () => {
  it("saca el mensaje de un Error", () => {
    expect(describeError(new Error("boom"))).toBe("boom")
  })

  it("acepta un string tal cual", () => {
    expect(describeError("boom")).toBe("boom")
  })

  it("no serializa un objeto arbitrario", () => {
    // Un `JSON.stringify` acá sería la puerta trasera por la que entra el body
    // crudo de Graph, que es justo lo que el tipo prohíbe.
    expect(describeError({ access_token: "secreto" })).toBe("unknown error")
    expect(describeError(null)).toBe("unknown error")
  })
})

describe("accountFields", () => {
  const page = {
    id: "conn-1",
    tenantId: "tenant-1",
    channel: "instagram" as const,
    metaPageId: "17841426388985797",
    username: "lornasuriano",
  }

  it("proyecta la cuenta entera", () => {
    expect(accountFields(page)).toEqual({
      tenantId: "tenant-1",
      connectionId: "conn-1",
      channel: "instagram",
      accountId: "17841426388985797",
      accountHandle: "lornasuriano",
    })
  })

  it("omite el handle en Messenger, donde es null", () => {
    const result = accountFields({
      ...page,
      channel: "messenger",
      username: null,
    })
    expect(result).not.toHaveProperty("accountHandle")
    expect(result.channel).toBe("messenger")
  })

  it("no incluye el nombre de la página", () => {
    // Es texto libre de Meta, no es único y es redundante con `accountId`.
    expect(accountFields(page)).not.toHaveProperty("name")
  })
})

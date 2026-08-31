import { describe, expect, it, vi } from "vitest"

import { es } from "@/content/i18n/app/es"

import {
  WhatsappApiError,
  WHATSAPP_COEXISTENCE_WEBHOOK_FIELDS,
  type WhatsappSignupTarget,
} from "@/lib/meta/whatsapp-client"
import {
  PageOwnershipError,
  type ConnectedPageRecord,
  type WhatsappNumberInput,
  type WhatsappNumberOwnership,
} from "@/lib/pages/page-registry"

import { readWhatsappSignupEvent } from "./signup-events"
import { parseWhatsappMode } from "./signup-launch"
import { decideWhatsappSubmission } from "./signup-submission"
import {
  checkWhatsappPlanSlot,
  LOG_REASON_BY_STEP,
  resolveWhatsappPinOrigin,
  runWhatsappSignup,
  type WhatsappSignupDeps,
  type WhatsappSignupRequest,
} from "./signup-flow"

const target = (
  overrides: Partial<WhatsappSignupTarget> = {}
): WhatsappSignupTarget => ({
  accessToken: "EAAtoken",
  tokenExpiresAt: null,
  wabaId: "waba-1",
  wabaName: "Café Rioja",
  phone: {
    id: "phone-1",
    displayPhoneNumber: "+34 600 000 000",
    phoneE164: "+34600000000",
    verifiedName: "Café Rioja",
    isOnBizApp: false,
  },
  mode: "standard",
  ...overrides,
})

const ownership = (
  overrides: Partial<WhatsappNumberOwnership> = {}
): WhatsappNumberOwnership => ({
  ownedByOtherTenant: false,
  activeForTenant: false,
  connectionId: null,
  storedPin: null,
  storedPinGenerated: false,
  ...overrides,
})

const page = (): ConnectedPageRecord =>
  ({
    id: "conn-1",
    tenantId: "tenant-1",
    channel: "whatsapp",
    metaPageId: "phone-1",
    name: "+34600000000",
  }) as ConnectedPageRecord

const request = (
  overrides: Partial<WhatsappSignupRequest> = {}
): WhatsappSignupRequest => ({
  tenantId: "tenant-1",
  code: "AQD-code",
  wabaId: "waba-1",
  phoneNumberId: "phone-1",
  mode: "standard",
  pin: null,
  ...overrides,
})

function deps(overrides: Partial<WhatsappSignupDeps> = {}) {
  const calls: string[] = []
  const connected: WhatsappNumberInput[] = []

  const base: WhatsappSignupDeps = {
    begin: async (input) => target({ mode: input.mode ?? "standard" }),
    finishStandard: async (signupTarget, input) => ({
      accessToken: signupTarget.accessToken,
      tokenExpiresAt: null,
      wabaId: signupTarget.wabaId,
      wabaName: signupTarget.wabaName,
      phoneNumberId: signupTarget.phone.id,
      phoneE164: signupTarget.phone.phoneE164,
      verifiedName: signupTarget.phone.verifiedName,
      pin: input.pin ?? "424242",
      pinGenerated: !input.pin,
      onboardingMode: "standard" as const,
      historySyncRequested: null,
    }),
    subscribe: async () => {},
    resolveOwnership: async () => ownership(),
    connect: async (_tenantId, input) => {
      connected.push(input)
      return page()
    },
    enqueueHistorySync: async () => {},
    enqueueTemplateSync: async () => {},
    markHistorySyncStatus: async () => {},
    ...overrides,
  }

  // El orden de las llamadas es la mitad de lo que hay que fijar acá —dónde cae
  // la comprobación de propiedad, qué pasa antes de persistir—, así que se
  // graba en el envoltorio y no dentro de cada doble: un `override` que se
  // olvidara de anotarse dejaría el test verde por el motivo equivocado.
  const recorded = Object.fromEntries(
    Object.entries(base).map(([name, fn]) => [
      name,
      vi.fn(async (...args: unknown[]) => {
        calls.push(name)
        return (fn as (...a: unknown[]) => unknown)(...args)
      }),
    ])
  ) as unknown as WhatsappSignupDeps

  return { deps: recorded, calls, connected }
}

describe("runWhatsappSignup — flujo A (estándar)", () => {
  it("registra el número y lo persiste como standard", async () => {
    const { deps: d, calls, connected } = deps()

    const outcome = await runWhatsappSignup(d, request())

    expect(outcome.kind).toBe("connected")
    expect(calls).toEqual([
      "begin",
      "resolveOwnership",
      "finishStandard",
      "connect",
      "enqueueTemplateSync",
    ])
    expect(connected[0]).toMatchObject({
      onboardingMode: "standard",
      // Sin historial que importar: `null`, no `complete`.
      historySyncStatus: null,
      pin: "424242",
      pinOrigin: "generated",
    })
    // El flujo estándar no pide historial ni encola nada.
    expect(d.enqueueHistorySync).not.toHaveBeenCalled()
  })

  it("persiste lo que confirmó Graph, no lo que dijo el navegador", async () => {
    const { deps: d, connected } = deps({
      begin: vi.fn(async () =>
        target({ phone: { ...target().phone, id: "phone-real" } })
      ),
    })

    await runWhatsappSignup(
      d,
      request({ phoneNumberId: "phone-mentira", wabaId: "waba-mentira" })
    )

    expect(connected[0]).toMatchObject({
      phoneNumberId: "phone-real",
      wabaId: "waba-1",
    })
  })

  it("reusa el PIN guardado al reconectar, sin marcarlo como del cliente", async () => {
    const { deps: d, connected } = deps({
      resolveOwnership: vi.fn(async () =>
        ownership({ activeForTenant: true, storedPin: "111111" })
      ),
    })

    await runWhatsappSignup(d, request())

    expect(d.finishStandard).toHaveBeenCalledWith(expect.anything(), {
      pin: "111111",
    })
    expect(connected[0]).toMatchObject({ pinOrigin: "stored" })
  })

  it("marca como del cliente el PIN que aportó tras un 133005", async () => {
    const { deps: d, connected } = deps({
      resolveOwnership: vi.fn(async () => ownership({ storedPin: "111111" })),
    })

    await runWhatsappSignup(d, request({ pin: "999999" }))

    expect(d.finishStandard).toHaveBeenCalledWith(expect.anything(), {
      pin: "999999",
    })
    expect(connected[0]).toMatchObject({ pinOrigin: "customer" })
  })

  it("devuelve pin_required en el 133005 en vez de un fallo genérico", async () => {
    const { deps: d } = deps({
      finishStandard: vi.fn(async () => {
        throw new WhatsappApiError(
          "phone number already has a two-step verification pin",
          "register",
          "pin_required",
          133005
        )
      }),
    })

    expect(await runWhatsappSignup(d, request())).toEqual({
      kind: "pin_required",
      metaErrorCode: 133005,
    })
  })
})

describe("runWhatsappSignup — flujo B (Coexistence)", () => {
  const coexistenceDeps = (overrides: Partial<WhatsappSignupDeps> = {}) =>
    deps({
      begin: vi.fn(async () =>
        target({
          mode: "coexistence",
          phone: { ...target().phone, isOnBizApp: true },
        })
      ),
      ...overrides,
    })

  it("NUNCA registra el número: /register lo desvincularía de la app", async () => {
    // Es la diferencia de comportamiento más cara del slice y no se deshace
    // desde acá: registrar un número que sigue vivo en la app de WhatsApp
    // Business lo saca de la app para siempre.
    const { deps: d, calls } = coexistenceDeps()

    await runWhatsappSignup(d, request({ mode: "coexistence" }))

    expect(d.finishStandard).not.toHaveBeenCalled()
    expect(calls).not.toContain("finishStandard")
  })

  it("suscribe la lista explícita antes de persistir, y en ese orden", async () => {
    const { deps: d, calls, connected } = coexistenceDeps()

    await runWhatsappSignup(d, request({ mode: "coexistence" }))

    expect(d.subscribe).toHaveBeenCalledWith("EAAtoken", "waba-1", {
      subscribedFields: WHATSAPP_COEXISTENCE_WEBHOOK_FIELDS,
    })
    // Lo que importa acá es que se suscribe **con la lista** y antes de
    // persistir; los nombres exactos de los campos los fija el test del cliente
    // de Meta, que es donde vive la constante.
    expect(WHATSAPP_COEXISTENCE_WEBHOOK_FIELDS).toContain("history")
    expect(calls).toEqual([
      "begin",
      "resolveOwnership",
      "subscribe",
      "connect",
      "enqueueHistorySync",
      "enqueueTemplateSync",
    ])
    expect(connected[0]).toMatchObject({
      onboardingMode: "coexistence",
      historySyncStatus: "not_requested",
      pin: null,
    })
  })

  it("no toca la marca del PIN de un registro anterior", async () => {
    const { deps: d, connected } = coexistenceDeps()

    await runWhatsappSignup(d, request({ mode: "coexistence" }))

    expect(connected[0]).toMatchObject({ pin: null, pinOrigin: "stored" })
  })

  it("encola la solicitud de historial con el id de la conexión", async () => {
    const { deps: d } = coexistenceDeps()

    const outcome = await runWhatsappSignup(d, request({ mode: "coexistence" }))

    expect(d.enqueueHistorySync).toHaveBeenCalledWith("conn-1")
    expect(outcome).toMatchObject({
      kind: "connected",
      historySync: "not_requested",
      historySyncError: null,
    })
  })

  it("deja el estado en failed —visible— cuando el encolado no sale", async () => {
    // El reloj de 24 h ya corre: si nadie va a pedir ese historial, el estado
    // no puede quedarse en `not_requested`, que se lee como «todavía no le
    // tocó».
    const { deps: d } = coexistenceDeps({
      enqueueHistorySync: vi.fn(async () => {
        throw new Error("queue unavailable")
      }),
    })

    const outcome = await runWhatsappSignup(d, request({ mode: "coexistence" }))

    expect(d.markHistorySyncStatus).toHaveBeenCalledWith("conn-1", "failed")
    expect(outcome).toMatchObject({
      kind: "connected",
      historySync: "failed",
      historySyncError: "queue unavailable",
    })
  })

  // El historial es el que tiene el reloj de 24 h encima: su encolado no puede
  // quedar detrás del de plantillas, que no vence nunca.
  it("encola el historial antes que el catálogo de plantillas", async () => {
    const { deps: d, calls } = coexistenceDeps()

    await runWhatsappSignup(d, request({ mode: "coexistence" }))

    expect(calls.indexOf("enqueueHistorySync")).toBeLessThan(
      calls.indexOf("enqueueTemplateSync")
    )
  })

  // Que el historial se caiga no puede llevarse puesto el catálogo: son dos
  // trabajos independientes y el segundo no depende de que el primero saliera.
  it("encola el catálogo aunque el historial no se haya podido encolar", async () => {
    const { deps: d } = coexistenceDeps({
      enqueueHistorySync: vi.fn(async () => {
        throw new Error("queue unavailable")
      }),
    })

    const outcome = await runWhatsappSignup(d, request({ mode: "coexistence" }))

    expect(d.enqueueTemplateSync).toHaveBeenCalledWith("conn-1")
    expect(outcome).toMatchObject({ historySync: "failed" })
  })

  it("sigue adelante sin phone_number_id: Graph resuelve el número vinculado", async () => {
    const { deps: d, connected } = coexistenceDeps()

    await runWhatsappSignup(
      d,
      request({ mode: "coexistence", phoneNumberId: null })
    )

    expect(d.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        hint: { wabaId: "waba-1", phoneNumberId: null },
        mode: "coexistence",
      })
    )
    expect(connected[0]).toMatchObject({ phoneNumberId: "phone-1" })
  })
})

describe("runWhatsappSignup — propiedad y fallos", () => {
  it("comprueba la propiedad entre la mitad reversible y la irreversible", async () => {
    const { deps: d, calls } = deps({
      resolveOwnership: vi.fn(async () => {
        return ownership({ ownedByOtherTenant: true })
      }),
    })

    const outcome = await runWhatsappSignup(d, request())

    expect(outcome).toEqual({
      kind: "owned_by_other_tenant",
      phoneNumberId: "phone-1",
    })
    // Nada irreversible llegó a pasar: ni suscripción ni registro.
    expect(calls).toEqual(["begin", "resolveOwnership"])
    expect(d.finishStandard).not.toHaveBeenCalled()
    expect(d.subscribe).not.toHaveBeenCalled()
  })

  it("también atrapa la carrera que ve el escritor", async () => {
    const { deps: d } = deps({
      connect: vi.fn(async () => {
        throw new PageOwnershipError("phone-1")
      }),
    })

    expect(await runWhatsappSignup(d, request())).toEqual({
      kind: "owned_by_other_tenant",
      phoneNumberId: "phone-1",
    })
  })

  it("reporta el paso exacto que falló", async () => {
    const { deps: d } = deps({
      begin: vi.fn(async () => {
        throw new WhatsappApiError("nope", "assets", "phone_not_in_waba", 100)
      }),
    })

    expect(await runWhatsappSignup(d, request())).toEqual({
      kind: "failed",
      step: "assets",
      metaErrorCode: 100,
      errorMessage: "nope",
    })
  })

  it("atribuye a persist lo que se rompe en nuestra base", async () => {
    const { deps: d } = deps({
      resolveOwnership: vi.fn(async () => {
        throw new Error("neon is down")
      }),
    })

    expect(await runWhatsappSignup(d, request())).toMatchObject({
      kind: "failed",
      step: "persist",
      errorMessage: "neon is down",
    })
  })

  it("tiene un motivo de log para cada paso del onboarding", () => {
    expect(Object.keys(LOG_REASON_BY_STEP).sort()).toEqual([
      "assets",
      "exchange",
      "persist",
      "register",
      "subscribe",
      "sync_request",
      // No es un paso del onboarding: `templates` entró en la unión porque la
      // administración de plantillas comparte el `graphRequest` del cliente
      // (ADR 0014). Aparece acá porque el mapa es exhaustivo a propósito.
      "templates",
    ])
  })
})

describe("resolveWhatsappPinOrigin", () => {
  it("el PIN que generamos nosotros es el único que se enseña", () => {
    expect(
      resolveWhatsappPinOrigin({
        submittedPin: null,
        storedPin: null,
        pinGenerated: true,
      })
    ).toBe("generated")
  })

  it("escribir el mismo PIN que ya teníamos no cambia de quién es", () => {
    // Le pasa a quien lo copia de la propia tarjeta.
    expect(
      resolveWhatsappPinOrigin({
        submittedPin: "111111",
        storedPin: "111111",
        pinGenerated: false,
      })
    ).toBe("stored")
  })

  it("un PIN distinto del guardado pasa a ser del cliente", () => {
    expect(
      resolveWhatsappPinOrigin({
        submittedPin: "999999",
        storedPin: "111111",
        pinGenerated: false,
      })
    ).toBe("customer")
  })

  it("sin PIN guardado y sin generarlo, el PIN es del cliente", () => {
    expect(
      resolveWhatsappPinOrigin({
        submittedPin: "999999",
        storedPin: null,
        pinGenerated: false,
      })
    ).toBe("customer")
  })
})

describe("checkWhatsappPlanSlot", () => {
  const slotDeps = (overrides = {}) => ({
    countActivePages: vi.fn(async () => 1),
    resolveMaxPages: vi.fn(async () => 2),
    resolveOwnership: vi.fn(async () => ownership()),
    ...overrides,
  })

  it("deja pasar cuando queda hueco", async () => {
    expect(
      await checkWhatsappPlanSlot(
        slotDeps(),
        {
          tenantId: "tenant-1",
          phoneNumberId: "phone-1",
        },
        es
      )
    ).toEqual({ ok: true })
  })

  it("deja reconectar un número que ya está activo aunque no quede cupo", async () => {
    const d = slotDeps({
      countActivePages: vi.fn(async () => 2),
      resolveOwnership: vi.fn(async () => ownership({ activeForTenant: true })),
    })

    expect(
      await checkWhatsappPlanSlot(
        d,
        {
          tenantId: "tenant-1",
          phoneNumberId: "phone-1",
        },
        es
      )
    ).toEqual({ ok: true })
  })

  it("sin pista del número no hay exención: el cupo se aplica entero", async () => {
    // Coexistence puede no reportar `phone_number_id`. Es el lado correcto en
    // el que fallar: un mensaje de cupo, y no una fila de más.
    const d = slotDeps({ countActivePages: vi.fn(async () => 2) })

    const result = await checkWhatsappPlanSlot(
      d,
      {
        tenantId: "tenant-1",
        phoneNumberId: null,
      },
      es
    )

    expect(result.ok).toBe(false)
    expect(d.resolveOwnership).not.toHaveBeenCalled()
  })

  it("falla cerrado si el plan no se puede resolver", async () => {
    const result = await checkWhatsappPlanSlot(
      slotDeps({ resolveMaxPages: vi.fn(async () => null) }),
      { tenantId: "tenant-1", phoneNumberId: "phone-1" },
      es
    )

    expect(result).toMatchObject({ ok: false, reason: "plan_restricted" })
  })

  it("falla cerrado si la consulta del cupo se cae", async () => {
    const result = await checkWhatsappPlanSlot(
      slotDeps({
        countActivePages: vi.fn(async () => {
          throw new Error("neon is down")
        }),
      }),
      { tenantId: "tenant-1", phoneNumberId: "phone-1" },
      es
    )

    expect(result).toMatchObject({ ok: false, reason: "internal_error" })
  })
})

// ---------------------------------------------------------------------------
// La invariante que no se puede romper, de punta a punta
// ---------------------------------------------------------------------------
//
// Desde que hay un solo botón, el `onboarding_mode` no lo elige nadie en la UI:
// lo deriva el evento de cierre del popup. Este bloque recorre la cadena entera
// —`postMessage` → modo derivado → cuerpo del POST → cierre en el servidor—
// porque cada eslabón está probado por separado y lo que importa es que el modo
// que sale del `FINISH*` sea el mismo que decide llamar o no a `/register`.
//
// `POST /{phone_number_id}/register` es irreversible: desvincula el número de la
// app de WhatsApp Business. Suponer el modo era registrar un número que el
// cliente quería seguir usando desde su teléfono.
describe("del postMessage a /register — el modo sale del evento de cierre", () => {
  // El popup, tal cual llega: `data` es un string JSON desde un origen de la
  // allowlist.
  const closingMessage = (event: string) => ({
    isTrusted: true,
    origin: "https://www.facebook.com",
    data: JSON.stringify({
      type: "WA_EMBEDDED_SIGNUP",
      event,
      data: { waba_id: "waba-1", phone_number_id: "phone-1" },
    }),
  })

  // Lo que el launcher y la ruta hacen entre el `postMessage` y el cierre: leer
  // el evento, emparejarlo con el `code` y sanear el cuerpo del POST. Nada de
  // esto puede inventar un modo: el único que existe es el del evento.
  const modeFromClosingEvent = (event: string) => {
    const signup = readWhatsappSignupEvent(closingMessage(event))
    expect(signup?.kind).toBe("finished")
    if (signup?.kind !== "finished") throw new Error("unreachable")

    const decision = decideWhatsappSubmission({
      code: "AQD-code",
      finish: { mode: signup.mode, assets: signup.assets },
      nonce: "nonce-1",
    })
    expect(decision.kind).toBe("submit")
    if (decision.kind !== "submit") throw new Error("unreachable")

    // El viaje por HTTP: el cuerpo llega como texto y la ruta lo sanea.
    return parseWhatsappMode(decision.mode)
  }

  it("un cierre de Coexistence NUNCA llega a registerWhatsappPhoneNumber", async () => {
    const mode = modeFromClosingEvent("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")
    expect(mode).toBe("coexistence")

    const { deps: d, calls } = deps({
      begin: vi.fn(async () =>
        target({
          mode: "coexistence",
          phone: { ...target().phone, isOnBizApp: true },
        })
      ),
    })

    await runWhatsappSignup(d, request({ mode }))

    // `finishStandard` es `finishWhatsappSignup`, y es el único camino del
    // producto hacia `registerWhatsappPhoneNumber`.
    expect(d.finishStandard).not.toHaveBeenCalled()
    expect(calls).not.toContain("finishStandard")
    expect(d.subscribe).toHaveBeenCalled()
  })

  it("y un cierre estándar sí lo registra: el mismo botón, el otro desenlace", async () => {
    const mode = modeFromClosingEvent("FINISH")
    expect(mode).toBe("standard")

    const { deps: d, connected } = deps()

    await runWhatsappSignup(d, request({ mode }))

    expect(d.finishStandard).toHaveBeenCalled()
    expect(connected[0]).toMatchObject({ onboardingMode: "standard" })
  })
})

// ---------------------------------------------------------------------------
// El sync del catálogo de plantillas (ADR 0014)
// ---------------------------------------------------------------------------

describe("runWhatsappSignup — sync del catálogo de plantillas", () => {
  const coexistence = (overrides: Partial<WhatsappSignupDeps> = {}) =>
    deps({
      begin: vi.fn(async () =>
        target({
          mode: "coexistence",
          phone: { ...target().phone, isOnBizApp: true },
        })
      ),
      ...overrides,
    })

  // El caso que hay que fijar con nombre y todo: en el flujo estándar el
  // catálogo suele estar vacío y el job termina en una llamada, así que es
  // justo el encolado que alguien borraría por parecer inútil. No lo es — la
  // plantilla vive en la WABA, y un número estándar puede entrar a una WABA que
  // ya tiene catálogo— y su ausencia no produce ningún error visible.
  it("se encola también en el flujo estándar, donde el catálogo suele estar vacío", async () => {
    const { deps: d } = deps()

    await runWhatsappSignup(d, request())

    expect(d.enqueueTemplateSync).toHaveBeenCalledWith("conn-1")
  })

  it("se encola en Coexistence, que es donde puede traer miles", async () => {
    const { deps: d } = coexistence()

    await runWhatsappSignup(d, request({ mode: "coexistence" }))

    expect(d.enqueueTemplateSync).toHaveBeenCalledWith("conn-1")
  })

  // A diferencia del historial, esto **no** degrada la conexión: no hay plazo
  // que se venza ni estado que corregir, y el número quedó operativo. Lo único
  // que se pierde es el listado hasta el próximo sync.
  it.each(["standard", "coexistence"] as const)(
    "un encolado fallido no rompe la conexión en el flujo %s",
    async (mode) => {
      const failing = {
        enqueueTemplateSync: vi.fn(async () => {
          throw new Error("queue unavailable")
        }),
      }
      const { deps: d } =
        mode === "coexistence" ? coexistence(failing) : deps(failing)

      const outcome = await runWhatsappSignup(d, request({ mode }))

      expect(outcome).toMatchObject({
        kind: "connected",
        templateSyncError: "queue unavailable",
      })
      // Nada se marca como fallido por esto: no hay columna de estado del
      // import de plantillas, y la del historial es de otro trabajo.
      expect(d.markHistorySyncStatus).not.toHaveBeenCalled()
    }
  )

  it("no reporta error cuando el encolado salió", async () => {
    const { deps: d } = deps()

    const outcome = await runWhatsappSignup(d, request())

    expect(outcome).toMatchObject({ templateSyncError: null })
  })
})

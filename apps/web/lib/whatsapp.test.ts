import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// El cliente lee las credenciales al importarse, así que hay que sembrarlas
// antes del import. WhatsApp vive en la misma Meta App que Messenger: usa
// `NEXT_PUBLIC_META_APP_ID` y `META_APP_SECRET`, no un par propio.
vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "meta-app-id")
vi.stubEnv("META_APP_SECRET", "meta-app-secret")

const { META_GRAPH_VERSION } = await import("./meta-graph")
const {
  assertWhatsappWabaShared,
  beginWhatsappSignup,
  completeWhatsappSignup,
  debugWhatsappToken,
  exchangeWhatsappCode,
  finishWhatsappSignup,
  generateWhatsappPin,
  listWhatsappPhoneNumbers,
  normalizeWhatsappPhoneE164,
  normalizeWhatsappPin,
  registerWhatsappPhoneNumber,
  resolveWhatsappPhoneNumber,
  resolveWhatsappTokenExpiry,
  subscribeWhatsappWebhook,
  WhatsappApiError,
  WHATSAPP_PIN_INCORRECT_CODE,
} = await import("./whatsapp")

const WABA_ID = "524126980791429"
const PHONE_NUMBER_ID = "106540352242922"
// A propósito no tiene la forma `EAA…` que el logger sabe tachar: si aparece en
// un log es porque este módulo lo escribió, no porque el scrubber falló.
const BUSINESS_TOKEN = "business-token-abc123"

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })

// Los seis pasos del onboarding, nombrados por la llamada que los ejecuta.
type Stage = "exchange" | "debug" | "waba" | "phones" | "subscribe" | "register"

function stageOf(href: string): Stage {
  if (href.includes("/oauth/access_token")) return "exchange"
  if (href.includes("/debug_token")) return "debug"
  if (href.includes("/phone_numbers")) return "phones"
  if (href.includes("/subscribed_apps")) return "subscribe"
  if (href.includes("/register")) return "register"
  return "waba"
}

type Handler = () => Response | Promise<Response>

const DEFAULT_HANDLERS: Record<Stage, Handler> = {
  exchange: () => jsonResponse({ access_token: BUSINESS_TOKEN }),
  debug: () =>
    jsonResponse({
      data: {
        app_id: "meta-app-id",
        is_valid: true,
        expires_at: 0,
        scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
        granular_scopes: [
          { scope: "whatsapp_business_management", target_ids: [WABA_ID] },
          { scope: "whatsapp_business_messaging", target_ids: [WABA_ID] },
        ],
      },
    }),
  waba: () => jsonResponse({ id: WABA_ID, name: "Jasper's Market" }),
  phones: () =>
    jsonResponse({
      data: [
        {
          verified_name: "Jasper's Market",
          display_phone_number: "+1 631-555-5555",
          id: PHONE_NUMBER_ID,
          quality_rating: "GREEN",
        },
      ],
    }),
  subscribe: () => jsonResponse({ success: true }),
  register: () => jsonResponse({ success: true }),
}

type GraphCall = { stage: Stage; url: string; init?: RequestInit }

function mockGraph(overrides: Partial<Record<Stage, Handler>> = {}) {
  const calls: GraphCall[] = []
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input.toString()
    const stage = stageOf(url)
    calls.push({ stage, url, init })
    return (overrides[stage] ?? DEFAULT_HANDLERS[stage])()
  })
  return calls
}

const signupInput = {
  code: "AQB-exchangeable-code",
  hint: { wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID },
}

// El logger escribe con `console.*`; se capturan las líneas para poder afirmar
// qué **no** sale en ellas.
let consoleLines: unknown[][] = []

beforeEach(() => {
  consoleLines = []
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleLines.push(args)
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("intercambio del code de Embedded Signup", () => {
  // El `redirect_uri` es lo que diferencia este canje del de Messenger: allá es
  // obligatorio e idéntico al del diálogo, acá no hay redirección que igualar.
  it("canjea sin redirect_uri y con las credenciales de la app de Meta", async () => {
    const calls = mockGraph()

    await expect(exchangeWhatsappCode("AQB-code")).resolves.toBe(BUSINESS_TOKEN)

    const url = new URL(calls[0]?.url ?? "")
    expect(url.origin).toBe("https://graph.facebook.com")
    expect(url.pathname).toBe(`/${META_GRAPH_VERSION}/oauth/access_token`)
    expect(url.searchParams.get("client_id")).toBe("meta-app-id")
    expect(url.searchParams.get("client_secret")).toBe("meta-app-secret")
    expect(url.searchParams.get("code")).toBe("AQB-code")
    expect(url.searchParams.get("redirect_uri")).toBeNull()
  })

  // Meta no documenta los códigos de este endpoint: el criterio es que no vino
  // el token, no un subcódigo adivinado.
  it("falla en el paso exchange cuando no vuelve access_token", async () => {
    mockGraph({
      exchange: () =>
        jsonResponse(
          { error: { message: "This authorization code has expired." } },
          { status: 400 }
        ),
    })

    await expect(exchangeWhatsappCode("AQB-code")).rejects.toMatchObject({
      name: "WhatsappApiError",
      step: "exchange",
      reason: "code_exchange_failed",
    })
  })
})

describe("debug_token: validez, permisos y propiedad", () => {
  it("inspecciona el token con el app token y devuelve los WABA compartidos", async () => {
    const calls = mockGraph()

    const debug = await debugWhatsappToken(BUSINESS_TOKEN)

    expect(debug.sharedWabaIds).toEqual([WABA_ID])
    expect(debug.expiresAt).toBeNull()

    const url = new URL(calls[0]?.url ?? "")
    expect(url.pathname).toBe(`/${META_GRAPH_VERSION}/debug_token`)
    expect(url.searchParams.get("input_token")).toBe(BUSINESS_TOKEN)
    // `debug_token` es la única llamada que va con el token de la app.
    expect(url.searchParams.get("access_token")).toBe(
      "meta-app-id|meta-app-secret"
    )
  })

  it("corta en assets si el token ya no es válido", async () => {
    mockGraph({
      debug: () =>
        jsonResponse({
          data: { is_valid: false, scopes: [], granular_scopes: [] },
        }),
    })

    await expect(debugWhatsappToken(BUSINESS_TOKEN)).rejects.toMatchObject({
      step: "assets",
      reason: "token_invalid",
    })
  })

  // `expires_at: 0` es «no vence»; cualquier otro valor es la fecha real. Se lee
  // en runtime porque la doc de Meta dice las dos cosas a la vez.
  it("lee la caducidad del token en vez de asumirla", () => {
    expect(resolveWhatsappTokenExpiry(0)).toBeNull()
    expect(resolveWhatsappTokenExpiry(undefined)).toBeNull()
    expect(resolveWhatsappTokenExpiry("no")).toBeNull()
    expect(resolveWhatsappTokenExpiry(1786000000)?.toISOString()).toBe(
      "2026-08-06T07:06:40.000Z"
    )
    expect(resolveWhatsappTokenExpiry("1786000000")?.toISOString()).toBe(
      "2026-08-06T07:06:40.000Z"
    )
  })

  // Un WABA bajo `business_management` dice que el usuario administra ese
  // negocio, no que nos compartió esa cuenta de WhatsApp.
  it("sólo cuenta los target_ids de los permisos de WhatsApp", async () => {
    mockGraph({
      debug: () =>
        jsonResponse({
          data: {
            is_valid: true,
            scopes: [
              "whatsapp_business_management",
              "whatsapp_business_messaging",
            ],
            granular_scopes: [
              { scope: "business_management", target_ids: ["999"] },
              {
                scope: "whatsapp_business_management",
                target_ids: [WABA_ID],
              },
            ],
          },
        }),
    })

    const debug = await debugWhatsappToken(BUSINESS_TOKEN)
    expect(debug.sharedWabaIds).toEqual([WABA_ID])
  })

  it("rechaza un token sin los dos permisos de WhatsApp", () => {
    expect(() =>
      assertWhatsappWabaShared(
        {
          expiresAt: null,
          scopes: ["whatsapp_business_management"],
          sharedWabaIds: [WABA_ID],
        },
        WABA_ID
      )
    ).toThrowError(
      expect.objectContaining({ step: "assets", reason: "missing_permissions" })
    )
  })

  // Falla cerrado: sin `granular_scopes` no se puede confirmar la propiedad, y
  // «no pude confirmar» no es «está bien».
  it("rechaza cuando no hay granular_scopes que mirar", () => {
    expect(() =>
      assertWhatsappWabaShared(
        {
          expiresAt: null,
          scopes: [
            "whatsapp_business_management",
            "whatsapp_business_messaging",
          ],
          sharedWabaIds: [],
        },
        WABA_ID
      )
    ).toThrowError(
      expect.objectContaining({ step: "assets", reason: "waba_not_shared" })
    )
  })
})

describe("números del WABA", () => {
  it("normaliza el display_phone_number a E.164", () => {
    expect(normalizeWhatsappPhoneE164("+1 631-555-5555")).toBe("+16315555555")
    expect(normalizeWhatsappPhoneE164("+52 1 55 5555 5555")).toBe(
      "+5215555555555"
    )
    expect(normalizeWhatsappPhoneE164(null)).toBeNull()
    expect(normalizeWhatsappPhoneE164("")).toBeNull()
  })

  it("lista los números del WABA con el token del cliente", async () => {
    const calls = mockGraph()

    const numbers = await listWhatsappPhoneNumbers(BUSINESS_TOKEN, WABA_ID)

    expect(numbers).toEqual([
      {
        id: PHONE_NUMBER_ID,
        displayPhoneNumber: "+1 631-555-5555",
        phoneE164: "+16315555555",
        verifiedName: "Jasper's Market",
      },
    ])
    expect(calls[0]?.url).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${WABA_ID}/phone_numbers`
    )
    // El token va en la cabecera, nunca en el query: así no puede acabar dentro
    // del mensaje de un error.
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${BUSINESS_TOKEN}`)
  })

  it("se queda con el número de la lista y no con lo que dijo el navegador", () => {
    const numbers = [
      {
        id: PHONE_NUMBER_ID,
        displayPhoneNumber: "+1 631-555-5555",
        phoneE164: "+16315555555",
        verifiedName: "Jasper's Market",
      },
    ]

    expect(resolveWhatsappPhoneNumber(numbers, PHONE_NUMBER_ID)).toBe(
      numbers[0]
    )
    expect(() =>
      resolveWhatsappPhoneNumber(numbers, "otro-numero")
    ).toThrowError(
      expect.objectContaining({ step: "assets", reason: "phone_not_in_waba" })
    )
    // Sin pista no se adivina: esa rama es de Coexistence y no está implementada.
    expect(() => resolveWhatsappPhoneNumber(numbers, null)).toThrowError(
      expect.objectContaining({
        step: "assets",
        reason: "missing_phone_number_id",
      })
    )
  })
})

describe("suscripción del WABA", () => {
  it("suscribe sobre el WABA y no sobre el número", async () => {
    const calls = mockGraph()

    await expect(
      subscribeWhatsappWebhook(BUSINESS_TOKEN, WABA_ID)
    ).resolves.toBeUndefined()

    expect(calls[0]?.url).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${WABA_ID}/subscribed_apps`
    )
    expect(calls[0]?.init?.method).toBe("POST")
  })

  it("falla en el paso subscribe si Meta no lo confirma", async () => {
    mockGraph({ subscribe: () => jsonResponse({ success: false }) })

    await expect(
      subscribeWhatsappWebhook(BUSINESS_TOKEN, WABA_ID)
    ).rejects.toMatchObject({
      step: "subscribe",
      reason: "subscription_failed",
    })
  })
})

describe("registro del número y su PIN", () => {
  it("manda messaging_product y el PIN como JSON", async () => {
    const calls = mockGraph()

    await registerWhatsappPhoneNumber(BUSINESS_TOKEN, PHONE_NUMBER_ID, "123456")

    expect(calls[0]?.url).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}/register`
    )
    expect(calls[0]?.init?.method).toBe("POST")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      messaging_product: "whatsapp",
      pin: "123456",
    })
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers.Authorization).toBe(`Bearer ${BUSINESS_TOKEN}`)
  })

  // 133005 = "Two-step verification PIN incorrect": el número ya tenía 2FA con
  // otro PIN, y la única salida es que lo aporte el cliente o lo desactive.
  it("mapea el 133005 a un fallo accionable de PIN", async () => {
    mockGraph({
      register: () =>
        jsonResponse(
          {
            error: {
              message: "Two-step verification PIN incorrect.",
              code: 133005,
            },
          },
          { status: 400 }
        ),
    })

    await expect(
      registerWhatsappPhoneNumber(BUSINESS_TOKEN, PHONE_NUMBER_ID, "123456")
    ).rejects.toMatchObject({
      step: "register",
      reason: "pin_required",
      metaErrorCode: WHATSAPP_PIN_INCORRECT_CODE,
    })
  })

  // Los demás códigos del registro no se traducen a nada accionable: van con su
  // número al log y la pantalla muestra el mensaje genérico.
  it("no inventa significados para los otros códigos", async () => {
    mockGraph({
      register: () =>
        jsonResponse(
          {
            error: {
              message: "Server is temporarily unavailable.",
              code: 133004,
            },
          },
          { status: 500 }
        ),
    })

    await expect(
      registerWhatsappPhoneNumber(BUSINESS_TOKEN, PHONE_NUMBER_ID, "1234")
    ).rejects.toMatchObject({
      step: "register",
      reason: "registration_failed",
      metaErrorCode: 133004,
    })
  })

  // El `maxLength={6}` del input es decoración: la server action se puede
  // invocar por POST directo, y hasta quien escribe en el campo llega pegando
  // desde un gestor de contraseñas. Sin esta puerta, un PIN con espacios salía
  // como un `registration_failed` genérico que manda a revisar si el número
  // está en uso en otra plataforma, que es exactamente lo que no pasó.
  it("acepta seis dígitos y limpia los espacios de un pegado", () => {
    expect(normalizeWhatsappPin("042713")).toEqual({
      ok: true,
      value: "042713",
    })
    expect(normalizeWhatsappPin("  042713 ")).toEqual({
      ok: true,
      value: "042713",
    })
    expect(normalizeWhatsappPin("04 27 13")).toEqual({
      ok: true,
      value: "042713",
    })
  })

  it("rechaza cualquier otra cosa diciendo qué es un PIN", () => {
    for (const value of ["", "12345", "1234567", "04-27-13", "abcdef", "0427a3"]) {
      const result = normalizeWhatsappPin(value)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.message).toContain("6 dígitos")
    }
  })

  it("genera un PIN de seis dígitos con el CSPRNG y sin sesgo", () => {
    // El primer valor cae fuera del rango sin sesgo y se descarta; el segundo se
    // acepta y se rellena con ceros a la izquierda.
    const values = [0xffffffff, 42]
    let index = 0
    const randomSpy = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation(((array: Uint32Array) => {
        array[0] = values[index++] ?? 0
        return array
      }) as typeof globalThis.crypto.getRandomValues)

    expect(generateWhatsappPin()).toBe("000042")
    expect(randomSpy).toHaveBeenCalledTimes(2)

    randomSpy.mockRestore()
    expect(generateWhatsappPin()).toMatch(/^\d{6}$/)
  })
})

describe("onboarding completo", () => {
  it("ejecuta los seis pasos en el orden de Meta y devuelve lo que hay que persistir", async () => {
    const calls = mockGraph({
      debug: () =>
        jsonResponse({
          data: {
            is_valid: true,
            expires_at: 1786000000,
            scopes: [
              "whatsapp_business_management",
              "whatsapp_business_messaging",
            ],
            granular_scopes: [
              { scope: "whatsapp_business_management", target_ids: [WABA_ID] },
              { scope: "whatsapp_business_messaging", target_ids: [WABA_ID] },
            ],
          },
        }),
    })

    const result = await completeWhatsappSignup(signupInput)

    // Meta suscribe **antes** de registrar: así el webhook ya está activo cuando
    // el número entra en servicio.
    expect(calls.map((call) => call.stage)).toEqual([
      "exchange",
      "debug",
      "waba",
      "phones",
      "subscribe",
      "register",
    ])

    expect(result).toMatchObject({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      wabaName: "Jasper's Market",
      phoneNumberId: PHONE_NUMBER_ID,
      phoneE164: "+16315555555",
      verifiedName: "Jasper's Market",
      pinGenerated: true,
      onboardingMode: "standard",
    })
    expect(result.tokenExpiresAt?.toISOString()).toBe(
      "2026-08-06T07:06:40.000Z"
    )
    // El PIN sale acá porque el llamador tiene que persistirlo cifrado: Meta no
    // lo devuelve nunca más y sin él no hay re-registro.
    expect(result.pin).toMatch(/^\d{6}$/)
    const registerCall = calls.find((call) => call.stage === "register")
    expect(JSON.parse(String(registerCall?.init?.body)).pin).toBe(result.pin)
  })

  it("usa el PIN del cliente cuando lo aporta, sin generar otro", async () => {
    const calls = mockGraph()

    const result = await completeWhatsappSignup({
      ...signupInput,
      pin: "998877",
    })

    expect(result).toMatchObject({ pin: "998877", pinGenerated: false })
    const registerCall = calls.find((call) => call.stage === "register")
    expect(JSON.parse(String(registerCall?.init?.body)).pin).toBe("998877")
  })

  // El navegador dice un `waba_id`; si el cliente no lo compartió con la app, es
  // un intento de reclamar una cuenta ajena y no un detalle de validación.
  it("rechaza el waba_id del popup que no está en los granular_scopes", async () => {
    const calls = mockGraph({
      debug: () =>
        jsonResponse({
          data: {
            is_valid: true,
            expires_at: 0,
            scopes: [
              "whatsapp_business_management",
              "whatsapp_business_messaging",
            ],
            granular_scopes: [
              {
                scope: "whatsapp_business_management",
                target_ids: ["999999999999999"],
              },
              {
                scope: "whatsapp_business_messaging",
                target_ids: ["999999999999999"],
              },
            ],
          },
        }),
    })

    await expect(completeWhatsappSignup(signupInput)).rejects.toMatchObject({
      step: "assets",
      reason: "waba_not_shared",
    })
    // Y no se llegó a tocar el WABA ni a suscribir nada.
    expect(calls.map((call) => call.stage)).toEqual(["exchange", "debug"])
  })

  it("rechaza el phone_number_id del popup que no cuelga del WABA", async () => {
    const calls = mockGraph({
      phones: () =>
        jsonResponse({
          data: [
            {
              id: "otro-numero",
              display_phone_number: "+1 631-555-0000",
              verified_name: "Otro",
            },
          ],
        }),
    })

    await expect(completeWhatsappSignup(signupInput)).rejects.toMatchObject({
      step: "assets",
      reason: "phone_not_in_waba",
    })
    expect(calls.map((call) => call.stage)).not.toContain("register")
  })

  it("aborta si el WABA que devuelve Graph no es el que se pidió", async () => {
    mockGraph({ waba: () => jsonResponse({ id: "otro-waba", name: "Otro" }) })

    await expect(completeWhatsappSignup(signupInput)).rejects.toMatchObject({
      step: "assets",
      reason: "waba_mismatch",
    })
  })

  // Sin esto, un DNS caído sale como un TypeError sin paso y el callback no
  // puede decir dónde se cortó el onboarding.
  it.each([
    ["exchange", "exchange"],
    ["debug", "assets"],
    ["waba", "assets"],
    ["phones", "assets"],
    ["subscribe", "subscribe"],
    ["register", "register"],
  ])("atribuye el fallo de red de %s al paso %s", async (stage, step) => {
    mockGraph({
      [stage as Stage]: () => Promise.reject(new TypeError("fetch failed")),
    })

    await expect(completeWhatsappSignup(signupInput)).rejects.toMatchObject({
      name: "WhatsappApiError",
      step,
      reason: "network_error",
    })
  })
})

// El corte entre las dos mitades es lo que permite meter la comprobación de
// propiedad —que es de nuestra base y no de Graph— antes de las llamadas que no
// se pueden deshacer. `/register` activa la verificación en dos pasos del número
// con el PIN que le mandemos, y no hay endpoint que la desactive.
describe("las dos mitades del onboarding", () => {
  it("la primera mitad confirma contra Graph sin suscribir ni registrar", async () => {
    const calls = mockGraph()

    const target = await beginWhatsappSignup(signupInput)

    expect(calls.map((call) => call.stage)).toEqual([
      "exchange",
      "debug",
      "waba",
      "phones",
    ])
    // Ni una llamada irreversible: si el llamador decide abortar acá, en Meta
    // no cambió nada.
    expect(calls.map((call) => call.stage)).not.toContain("subscribe")
    expect(calls.map((call) => call.stage)).not.toContain("register")

    expect(target).toMatchObject({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      wabaName: "Jasper's Market",
    })
    // El número sale de `/{waba_id}/phone_numbers`, que es la única fuente de
    // verdad del `phone_number_id`: es con ese id, y no con el del navegador,
    // con el que se puede preguntar de quién es el número.
    expect(target.phone.id).toBe(PHONE_NUMBER_ID)
    expect(target.phone.phoneE164).toBe("+16315555555")
  })

  it("la segunda mitad suscribe, registra y devuelve lo que hay que persistir", async () => {
    const calls = mockGraph()
    const target = await beginWhatsappSignup(signupInput)
    calls.length = 0

    const result = await finishWhatsappSignup(target, { pin: "998877" })

    expect(calls.map((call) => call.stage)).toEqual(["subscribe", "register"])
    expect(result).toMatchObject({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      phoneNumberId: PHONE_NUMBER_ID,
      pin: "998877",
      pinGenerated: false,
      onboardingMode: "standard",
    })
  })

  it("sin PIN, la segunda mitad genera uno y lo marca como nuestro", async () => {
    mockGraph()
    const target = await beginWhatsappSignup(signupInput)

    const result = await finishWhatsappSignup(target)

    expect(result.pin).toMatch(/^\d{6}$/)
    expect(result.pinGenerated).toBe(true)
  })
})

describe("higiene de secretos y de versión", () => {
  // El body del canje trae el business token en claro. Aunque en un no-2xx lo
  // que llega es un sobre de error, basta un cambio de Meta para volcarlo al
  // log: por eso se extraen código y mensaje, nunca el body.
  it("no escribe el token ni el secreto en ninguna línea de log", async () => {
    mockGraph({
      exchange: () =>
        jsonResponse(
          {
            access_token: BUSINESS_TOKEN,
            error: { message: "invalid code", code: 100 },
          },
          { status: 400 }
        ),
    })
    await expect(completeWhatsappSignup(signupInput)).rejects.toBeInstanceOf(
      WhatsappApiError
    )

    vi.restoreAllMocks()
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args)
      })
    }

    mockGraph({
      debug: () =>
        jsonResponse({
          data: { is_valid: false, scopes: [], granular_scopes: [] },
        }),
    })
    await expect(completeWhatsappSignup(signupInput)).rejects.toBeInstanceOf(
      WhatsappApiError
    )

    mockGraph({ register: () => jsonResponse({ success: false }) })
    await expect(completeWhatsappSignup(signupInput)).rejects.toBeInstanceOf(
      WhatsappApiError
    )

    const written = JSON.stringify(consoleLines)
    expect(written).toContain("invalid code")
    expect(written).not.toContain(BUSINESS_TOKEN)
    expect(written).not.toContain("meta-app-secret")
    expect(written).not.toContain(signupInput.code)
  })

  // El invariante que el módulo declara arriba de `bearer()`, fijado tal como
  // es. El comentario decía que **todas** las llamadas mandan el token en
  // `Authorization` «y no en el query», y era falso en dos: el canje pone
  // `client_secret` y `debug_token` pone los dos tokens. Un invariante escrito
  // que no se cumple es peor que no escribirlo, porque el que extienda el módulo
  // lo hereda; esto lo deja fijado con sus excepciones nombradas, de modo que
  // una tercera llamada con credenciales en el query rompa el test.
  it("solo el canje y debug_token llevan credenciales en el query", async () => {
    const calls = mockGraph()

    await completeWhatsappSignup(signupInput)

    const withQueryCredentials = calls.filter((call) => {
      const params = new URL(call.url).searchParams
      return (
        params.has("client_secret") ||
        params.has("access_token") ||
        params.has("input_token")
      )
    })
    expect(withQueryCredentials.map((call) => call.stage)).toEqual([
      "exchange",
      "debug",
    ])

    // `debug_token` es la única que lleva el token del cliente en la URL, y lo
    // lleva como sujeto de la consulta (`input_token`), no como credencial.
    const inUrl = calls.filter((call) => call.url.includes(BUSINESS_TOKEN))
    expect(inUrl.map((call) => call.stage)).toEqual(["debug"])

    // Las cuatro restantes lo llevan en la cabecera.
    for (const call of calls.filter(
      (item) => item.stage !== "exchange" && item.stage !== "debug"
    )) {
      const headers = call.init?.headers as Record<string, string>
      expect(headers.Authorization).toBe(`Bearer ${BUSINESS_TOKEN}`)
    }
  })

  it("arma todas las URLs con META_GRAPH_VERSION", async () => {
    const calls = mockGraph()

    await completeWhatsappSignup(signupInput)

    expect(calls).toHaveLength(6)
    for (const call of calls) {
      expect(
        call.url.startsWith(`https://graph.facebook.com/${META_GRAPH_VERSION}/`)
      ).toBe(true)
    }
  })

  // La versión sube en `lib/meta-graph.ts` y en su gemela del Worker; si alguien
  // la escribe a mano acá, las dos apps le hablan a Graph distinto.
  it("no hardcodea ninguna versión de Graph en el módulo", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./whatsapp.ts", import.meta.url)),
      "utf8"
    )

    expect(source).toContain("META_GRAPH_VERSION")
    expect(source).not.toMatch(/v\d+\.\d+/)
  })
})

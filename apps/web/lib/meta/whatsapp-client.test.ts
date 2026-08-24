import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// El cliente lee las credenciales al importarse, así que hay que sembrarlas
// antes del import. WhatsApp vive en la misma Meta App que Messenger: usa
// `NEXT_PUBLIC_META_APP_ID` y `META_APP_SECRET`, no un par propio.
vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "meta-app-id")
vi.stubEnv("META_APP_SECRET", "meta-app-secret")

const { META_GRAPH_VERSION } = await import("./graph-version")
const {
  assertWhatsappWabaShared,
  beginWhatsappSignup,
  buildWhatsappMessagePayload,
  completeWhatsappSignup,
  debugWhatsappToken,
  downloadWhatsappMedia,
  exceedsWhatsappTextLimit,
  exchangeWhatsappCode,
  explainWhatsappError,
  extractWhatsappMessageId,
  fetchWhatsappMediaMetadata,
  finishWhatsappSignup,
  generateWhatsappPin,
  listWhatsappPhoneNumbers,
  normalizeWhatsappPhoneE164,
  normalizeWhatsappPin,
  registerWhatsappPhoneNumber,
  requestWhatsappHistorySync,
  resolveWhatsappPhoneNumber,
  resolveWhatsappTokenExpiry,
  sendWhatsappMessage,
  subscribeWhatsappWebhook,
  WhatsappApiError,
  WHATSAPP_COEXISTENCE_WEBHOOK_FIELDS,
  WHATSAPP_PIN_INCORRECT_CODE,
  WHATSAPP_RATE_LIMIT_REASON,
  WHATSAPP_TOKEN_EXPIRED_REASON,
  WHATSAPP_WINDOW_CLOSED_REASON,
} = await import("./whatsapp-client")

const WABA_ID = "524126980791429"
const PHONE_NUMBER_ID = "106540352242922"
const MEDIA_ID = "1013859600285441"
// A propósito no tiene la forma `EAA…` que el logger sabe tachar: si aparece en
// un log es porque este módulo lo escribió, no porque el scrubber falló.
const BUSINESS_TOKEN = "business-token-abc123"
// La URL temporal de la media: cinco minutos de vida y una credencial de lectura
// sobre contenido del cliente. Ningún log ni ninguna fila puede contenerla.
const MEDIA_URL =
  "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=temporary-media-token"

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })

// Los pasos, nombrados por la llamada que los ejecuta.
type Stage =
  | "exchange"
  | "debug"
  | "waba"
  | "phones"
  | "subscribe"
  | "register"
  | "sync"
  | "media"
  | "download"
  | "send"

function stageOf(href: string): Stage {
  if (href.includes("lookaside.fbsbx.com")) return "download"
  if (href.includes("/oauth/access_token")) return "exchange"
  if (href.includes("/debug_token")) return "debug"
  if (href.includes("/phone_numbers")) return "phones"
  if (href.includes("/subscribed_apps")) return "subscribe"
  if (href.includes("/register")) return "register"
  if (href.includes("/smb_app_data")) return "sync"
  if (href.includes("/messages")) return "send"
  if (href.includes(MEDIA_ID)) return "media"
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
  sync: () => jsonResponse({ success: true }),
  media: () =>
    jsonResponse({
      id: MEDIA_ID,
      url: MEDIA_URL,
      mime_type: "image/jpeg",
      file_size: 2048,
      sha256: "b1946ac92492d2347c6235b4d2611184",
      messaging_product: "whatsapp",
    }),
  download: () =>
    new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "4" },
    }),
  send: () =>
    jsonResponse({
      messaging_product: "whatsapp",
      contacts: [{ input: "16315551234", wa_id: "16315551234" }],
      messages: [{ id: "wamid.HBgLMTYzMTU1NTE=" }],
    }),
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

// El número de Coexistence: el mismo WABA, pero con la marca de estar vinculado
// a la app de WhatsApp Business y sin `phone_number_id` en el `postMessage`.
const coexistencePhones = (
  rows: Array<Record<string, unknown>> = [
    {
      verified_name: "Jasper's Market",
      display_phone_number: "+1 631-555-5555",
      id: PHONE_NUMBER_ID,
      is_on_biz_app: true,
    },
  ]
) => jsonResponse({ data: rows })

const signupInput = {
  code: "AQB-exchangeable-code",
  hint: { wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID },
}

const coexistenceInput = {
  code: "AQB-exchangeable-code",
  hint: { wabaId: WABA_ID },
  mode: "coexistence" as const,
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

  // Ninguna llamada puede nacer sin plazo: un `fetch` sin señal se cuelga hasta
  // el timeout del runtime, que en un Worker es el de la request entera.
  it("le pone un AbortSignal a toda llamada a Graph", async () => {
    const calls = mockGraph()

    await completeWhatsappSignup(signupInput)

    for (const call of calls) {
      expect(call.init?.signal).toBeInstanceOf(AbortSignal)
    }
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
        // Ausente cuenta como `false`: es la lectura que falla cerrado.
        isOnBizApp: false,
      },
    ])

    const url = new URL(calls[0]?.url ?? "")
    expect(url.origin + url.pathname).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${WABA_ID}/phone_numbers`
    )
    // `is_on_biz_app` no viene en la proyección por defecto y es el campo con el
    // que Coexistence decide: sin pedirlo, esa rama no tendría con qué.
    expect(url.searchParams.get("fields")).toContain("is_on_biz_app")
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
        isOnBizApp: false,
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
    // Sin pista no se adivina: en el flujo estándar la pista viene siempre, y
    // caer en «si hay uno solo, ese» convertiría un bug del launcher en una
    // conexión silenciosa al número equivocado.
    expect(() => resolveWhatsappPhoneNumber(numbers, null)).toThrowError(
      expect.objectContaining({
        step: "assets",
        reason: "missing_phone_number_id",
      })
    )
  })
})

// La rama que el módulo del que sale este cliente dejó explícitamente sin
// implementar. Resolver el número desde la lista es lo que permite que
// Coexistence funcione sin `phone_number_id` en el `postMessage`, y las tres
// reglas de abajo son las que impiden que «resolver» se convierta en «adivinar».
describe("resolución del número en Coexistence", () => {
  const linked = {
    id: PHONE_NUMBER_ID,
    displayPhoneNumber: "+1 631-555-5555",
    phoneE164: "+16315555555",
    verifiedName: "Jasper's Market",
    isOnBizApp: true,
  }
  const plain = { ...linked, id: "otro-numero", isOnBizApp: false }

  it("toma el único número vinculado a la app de WhatsApp Business", () => {
    expect(
      resolveWhatsappPhoneNumber([plain, linked], null, "coexistence")
    ).toBe(linked)
  })

  it("corta si ninguno está en la app en vez de tomar el primero", () => {
    expect(() =>
      resolveWhatsappPhoneNumber([plain], null, "coexistence")
    ).toThrowError(
      expect.objectContaining({
        step: "assets",
        reason: "coexistence_number_not_found",
      })
    )
  })

  // Un WABA con dos números en la app es raro pero posible, y elegir mal es
  // conectar el número equivocado y pedirle el historial de otro negocio.
  it("corta si hay más de uno en vez de elegir", () => {
    expect(() =>
      resolveWhatsappPhoneNumber(
        [linked, { ...linked, id: "segundo" }],
        null,
        "coexistence"
      )
    ).toThrowError(
      expect.objectContaining({
        step: "assets",
        reason: "coexistence_number_ambiguous",
      })
    )
  })

  it("usa la pista si llega, pero sigue exigiendo que esté en la app", () => {
    expect(
      resolveWhatsappPhoneNumber(
        [plain, linked],
        PHONE_NUMBER_ID,
        "coexistence"
      )
    ).toBe(linked)
    // Un número normal metido por esta rama no se registraría nunca y el canal
    // quedaría conectado y mudo.
    expect(() =>
      resolveWhatsappPhoneNumber([plain], "otro-numero", "coexistence")
    ).toThrowError(
      expect.objectContaining({
        step: "assets",
        reason: "coexistence_number_not_linked",
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

  // En el estándar la llamada va pelada: pasar una lista ahí estrecharía la
  // suscripción a lo que hoy sabemos leer.
  it("no manda subscribed_fields si no se los pide", async () => {
    const calls = mockGraph()

    await subscribeWhatsappWebhook(BUSINESS_TOKEN, WABA_ID)

    expect(calls[0]?.url).not.toContain("subscribed_fields")
  })

  it("manda los tres campos de Coexistence cuando se los pide", async () => {
    const calls = mockGraph()

    await subscribeWhatsappWebhook(BUSINESS_TOKEN, WABA_ID, {
      subscribedFields: WHATSAPP_COEXISTENCE_WEBHOOK_FIELDS,
    })

    const url = new URL(calls[0]?.url ?? "")
    expect(url.searchParams.get("subscribed_fields")).toBe(
      "history,smb_app_state_sync,smb_message_echoes"
    )
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
    for (const value of [
      "",
      "12345",
      "1234567",
      "04-27-13",
      "abcdef",
      "0427a3",
    ]) {
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

// El historial no llega solo: hay que pedirlo, y esta llamada es la que arranca
// el reloj de 24 horas.
describe("solicitud de history sync", () => {
  it("pide el sync sobre el número con sync_type history", async () => {
    const calls = mockGraph()

    await expect(
      requestWhatsappHistorySync(BUSINESS_TOKEN, PHONE_NUMBER_ID)
    ).resolves.toBeUndefined()

    expect(calls[0]?.url).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}/smb_app_data`
    )
    expect(calls[0]?.init?.method).toBe("POST")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      messaging_product: "whatsapp",
      sync_type: "history",
    })
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${BUSINESS_TOKEN}`)
  })

  it("falla en su propio paso para que el callback sepa dónde se cortó", async () => {
    mockGraph({
      sync: () =>
        jsonResponse(
          { error: { message: "nope", code: 100 } },
          { status: 400 }
        ),
    })

    await expect(
      requestWhatsappHistorySync(BUSINESS_TOKEN, PHONE_NUMBER_ID)
    ).rejects.toMatchObject({
      step: "sync_request",
      reason: "history_sync_failed",
      metaErrorCode: 100,
    })
  })
})

describe("media entrante", () => {
  it("pide el sobre y después los bytes, las dos con el Bearer", async () => {
    const calls = mockGraph()

    const download = await downloadWhatsappMedia(BUSINESS_TOKEN, MEDIA_ID, {
      phoneNumberId: PHONE_NUMBER_ID,
    })

    expect(calls.map((call) => call.stage)).toEqual(["media", "download"])
    expect(download.mimeType).toBe("image/jpeg")
    expect(download.fileSize).toBe(4)
    expect(new Uint8Array(download.bytes)).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    )

    // La segunda llamada va al CDN, no al Graph, y **también** va autenticada:
    // sin la cabecera Meta responde 401 aunque la URL esté fresca.
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string>
      expect(headers.Authorization).toBe(`Bearer ${BUSINESS_TOKEN}`)
    }
    expect(calls[1]?.url).toBe(MEDIA_URL)
  })

  // `phone_number_id` es la comprobación de propiedad del lado de Meta: con él,
  // un media id de otro número responde 404 en vez de resolver.
  it("manda el phone_number_id cuando lo tiene", async () => {
    const calls = mockGraph()

    await fetchWhatsappMediaMetadata(BUSINESS_TOKEN, MEDIA_ID, {
      phoneNumberId: PHONE_NUMBER_ID,
    })

    const url = new URL(calls[0]?.url ?? "")
    expect(url.searchParams.get("phone_number_id")).toBe(PHONE_NUMBER_ID)
  })

  // El id vive 7 días si vino del webhook: un 404 acá es casi siempre «venció».
  it("corta con media_not_found si el sobre no trae url", async () => {
    mockGraph({
      media: () =>
        jsonResponse(
          { error: { message: "Unsupported get request.", code: 100 } },
          { status: 404 }
        ),
    })

    await expect(
      fetchWhatsappMediaMetadata(BUSINESS_TOKEN, MEDIA_ID)
    ).rejects.toMatchObject({ reason: "media_not_found" })
  })

  it("distingue el fallo de la descarga del fallo del sobre", async () => {
    mockGraph({
      download: () => new Response("expired", { status: 401 }),
    })

    await expect(
      downloadWhatsappMedia(BUSINESS_TOKEN, MEDIA_ID)
    ).rejects.toMatchObject({ reason: "media_download_failed" })
  })

  // La URL temporal es una credencial de lectura con cinco minutos de vida:
  // guardarla sería dejar un enlace que caduca en una fila que no caduca, y
  // escribirla en un log sería publicarla.
  it("nunca escribe la URL temporal en el log", async () => {
    mockGraph({ download: () => new Response("nope", { status: 403 }) })

    await expect(
      downloadWhatsappMedia(BUSINESS_TOKEN, MEDIA_ID)
    ).rejects.toBeInstanceOf(WhatsappApiError)

    const written = JSON.stringify(consoleLines)
    expect(written).not.toContain(MEDIA_URL)
    expect(written).not.toContain("temporary-media-token")
    expect(written).not.toContain(BUSINESS_TOKEN)
    // Lo que sí sale es el status, que es lo que distingue «venció la URL» de
    // «Meta se cayó».
    expect(written).toContain("403")
  })
})

describe("envío", () => {
  it("manda el texto con messaging_product y el token en la cabecera", async () => {
    const calls = mockGraph()

    const result = await sendWhatsappMessage({
      accessToken: BUSINESS_TOKEN,
      phoneNumberId: PHONE_NUMBER_ID,
      to: "16315551234",
      message: { text: "hola" },
    })

    expect(result.ok).toBe(true)
    expect(calls[0]?.url).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`
    )
    // El token en la cabecera y **no** en el query: `?access_token=` es la forma
    // de la Send API de Messenger y deja el token dentro de cualquier URL que se
    // loguee.
    expect(calls[0]?.url).not.toContain("access_token")
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${BUSINESS_TOKEN}`)
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "16315551234",
      type: "text",
      text: { body: "hola", preview_url: false },
    })
  })

  // La clave del objeto **es** el tipo. Mandar `attachment` —la forma de
  // Messenger— da un 400 genérico.
  it("arma la media por link con el tipo como clave", () => {
    expect(
      buildWhatsappMessagePayload("1631", {
        media: { type: "image", link: "https://cdn.cliente/foto.jpg" },
      })
    ).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "1631",
      type: "image",
      image: { link: "https://cdn.cliente/foto.jpg" },
    })

    expect(
      buildWhatsappMessagePayload("1631", {
        media: {
          type: "document",
          link: "https://cdn.cliente/factura.pdf",
          filename: "factura.pdf",
          caption: "tu factura",
        },
      })
    ).toMatchObject({
      type: "document",
      document: {
        link: "https://cdn.cliente/factura.pdf",
        filename: "factura.pdf",
        caption: "tu factura",
      },
    })
  })

  // `audio` no lleva caption y `filename` sólo lo lee `document`: mandarlos
  // igual hace que Meta rechace el mensaje entero en vez de ignorar el campo.
  it("no manda caption en audio ni filename fuera de document", () => {
    const audio = buildWhatsappMessagePayload("1631", {
      media: {
        type: "audio",
        link: "https://cdn.cliente/nota.ogg",
        caption: "no va",
      },
    })
    expect(audio.audio).toEqual({ link: "https://cdn.cliente/nota.ogg" })

    const image = buildWhatsappMessagePayload("1631", {
      media: {
        type: "image",
        link: "https://cdn.cliente/foto.jpg",
        filename: "foto.jpg",
      },
    })
    expect(image.image).toEqual({ link: "https://cdn.cliente/foto.jpg" })
  })

  // Cloud API no devuelve `message_id` como Messenger: reusar la extracción de
  // allá devolvería `null` siempre y el mensaje quedaría sin el id con el que
  // después llegan sus `statuses`.
  it("saca el wamid de messages[0].id", () => {
    expect(extractWhatsappMessageId({ messages: [{ id: "wamid.ABC" }] })).toBe(
      "wamid.ABC"
    )
    expect(extractWhatsappMessageId({ message_id: "mid.ABC" })).toBeNull()
    expect(extractWhatsappMessageId({ messages: [] })).toBeNull()
    expect(extractWhatsappMessageId(null)).toBeNull()
  })

  it("traduce el error del envío en el mismo sobre que Messenger", async () => {
    mockGraph({
      send: () =>
        jsonResponse(
          { error: { message: "Re-engagement message", code: 131047 } },
          { status: 400 }
        ),
    })

    const result = await sendWhatsappMessage({
      accessToken: BUSINESS_TOKEN,
      phoneNumberId: PHONE_NUMBER_ID,
      to: "16315551234",
      message: { text: "hola" },
    })

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: "Re-engagement message",
      reason: WHATSAPP_WINDOW_CLOSED_REASON,
      code: null,
    })
  })

  it("cuenta caracteres y no bytes, a diferencia de Instagram", () => {
    expect(exceedsWhatsappTextLimit("a".repeat(4096))).toBe(false)
    expect(exceedsWhatsappTextLimit("a".repeat(4097))).toBe(true)
    // 4096 emojis son 16 KB de UTF-8 y siguen siendo 4096 caracteres.
    expect(exceedsWhatsappTextLimit("😀".repeat(4096))).toBe(false)
  })
})

// Catálogo propio y no una reutilización del de Messenger: los códigos coinciden
// en parte, pero lo que el cliente tiene que hacer es distinto.
describe("catálogo de errores de WhatsApp", () => {
  it("traduce los códigos con acción clara", () => {
    const message = (code: number) =>
      explainWhatsappError({ error: { code } })?.message

    expect(message(190)).toBe(WHATSAPP_TOKEN_EXPIRED_REASON)
    expect(message(131047)).toBe(WHATSAPP_WINDOW_CLOSED_REASON)
    expect(message(131026)).toContain("couldn't deliver")
    expect(message(131031)).toContain("locked or disabled")
    expect(message(133005)).toContain("two-step verification")
    expect(message(368)).toContain("policy violation")
  })

  // 130429 es el techo de throughput de Cloud API y los otros cuatro son los
  // límites de app de Graph: distinta capa, misma acción.
  it.each([130429, 4, 17, 32, 613])(
    "manda el %i a esperar y reintentar",
    (code) => {
      expect(explainWhatsappError({ error: { code } })?.message).toBe(
        WHATSAPP_RATE_LIMIT_REASON
      )
    }
  )

  // Los fallos de media son los únicos con `code` estable, porque son los únicos
  // que la API pública tiene que distinguir programáticamente.
  it("le pone código estable sólo a los fallos de media", () => {
    expect(explainWhatsappError({ error: { code: 131053 } })).toEqual({
      code: "attachment_fetch_failed",
      message: expect.stringContaining("couldn't download the media"),
    })
    expect(explainWhatsappError({ error: { code: 131052 } })).toEqual({
      code: "media_download_failed",
      message: expect.stringContaining("couldn't retrieve the media"),
    })
    expect(explainWhatsappError({ error: { code: 190 } })?.code).toBeNull()
  })

  // `null` significa «no hay traducción, a propósito»: el mensaje crudo de Meta
  // viaja igual, y traducir de más le inventaría al cliente una causa.
  it("devuelve null cuando no hay nada que decir", () => {
    expect(explainWhatsappError({ error: { code: 131000 } })).toBeNull()
    expect(
      explainWhatsappError({ error: { message: "sin código" } })
    ).toBeNull()
    expect(explainWhatsappError(null)).toBeNull()
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
      // El flujo estándar no tiene historial que pedir.
      historySyncRequested: null,
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

// El flujo B. Comparte el canje, la validación de assets y la lectura del WABA;
// se separa en que suscribe los tres campos, **no registra** y pide el historial.
describe("onboarding de Coexistence", () => {
  it("suscribe los tres campos, pide el sync y NO llama a /register", async () => {
    const calls = mockGraph({ phones: () => coexistencePhones() })

    const result = await completeWhatsappSignup(coexistenceInput)

    expect(calls.map((call) => call.stage)).toEqual([
      "exchange",
      "debug",
      "waba",
      "phones",
      "subscribe",
      "sync",
    ])
    // **La regla del flujo B.** Registrar un número que ya opera desde la app de
    // WhatsApp Business lo desvincula de la app, que es exactamente lo que
    // Coexistence existe para no hacer.
    expect(calls.map((call) => call.stage)).not.toContain("register")

    const subscribeCall = calls.find((call) => call.stage === "subscribe")
    expect(
      new URL(subscribeCall?.url ?? "").searchParams.get("subscribed_fields")
    ).toBe("history,smb_app_state_sync,smb_message_echoes")

    expect(result).toMatchObject({
      wabaId: WABA_ID,
      phoneNumberId: PHONE_NUMBER_ID,
      phoneE164: "+16315555555",
      onboardingMode: "coexistence",
      // Sin `/register` no hay PIN que persistir: la columna de la 0017 es
      // nullable justamente por esto.
      pin: null,
      pinGenerated: false,
      historySyncRequested: true,
    })
  })

  // La suscripción va **antes** del sync: pedirlo sin la suscripción a `history`
  // sería tirar los chunks que llegaran mientras tanto, y el sync no se pide dos
  // veces.
  it("suscribe antes de arrancar el reloj de 24 horas", async () => {
    const calls = mockGraph({ phones: () => coexistencePhones() })

    await completeWhatsappSignup(coexistenceInput)

    const stages = calls.map((call) => call.stage)
    expect(stages.indexOf("subscribe")).toBeLessThan(stages.indexOf("sync"))
  })

  it("no llega al sync si la suscripción falla", async () => {
    const calls = mockGraph({
      phones: () => coexistencePhones(),
      subscribe: () => jsonResponse({ success: false }),
    })

    await expect(
      completeWhatsappSignup(coexistenceInput)
    ).rejects.toMatchObject({ step: "subscribe" })
    expect(calls.map((call) => call.stage)).not.toContain("sync")
  })

  it("resuelve el número sin pista del navegador", async () => {
    mockGraph({
      phones: () =>
        coexistencePhones([
          {
            id: "numero-sin-app",
            display_phone_number: "+1 631-555-0000",
            verified_name: "Otro",
          },
          {
            id: PHONE_NUMBER_ID,
            display_phone_number: "+1 631-555-5555",
            verified_name: "Jasper's Market",
            is_on_biz_app: true,
          },
        ]),
    })

    const target = await beginWhatsappSignup(coexistenceInput)
    expect(target.phone.id).toBe(PHONE_NUMBER_ID)
    expect(target.mode).toBe("coexistence")
  })

  // El fallo del sync es su propio paso: `history_sync_status='failed'` es un
  // estado accionable en Connections, no un detalle del onboarding.
  it("corta en sync_request si Meta rechaza la solicitud", async () => {
    mockGraph({
      phones: () => coexistencePhones(),
      sync: () => jsonResponse({ success: false }, { status: 400 }),
    })

    await expect(
      completeWhatsappSignup(coexistenceInput)
    ).rejects.toMatchObject({
      step: "sync_request",
      reason: "history_sync_failed",
    })
  })
})

// El corte entre las dos mitades es lo que permite meter la comprobación de
// propiedad —que es de nuestra base y no de Graph— antes de las llamadas que no
// se pueden deshacer. `/register` activa la verificación en dos pasos del número
// con el PIN que le mandemos, y no hay endpoint que la desactive; la solicitud
// de historial arranca un reloj de 24 horas que no se reinicia.
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
    expect(calls.map((call) => call.stage)).not.toContain("sync")

    expect(target).toMatchObject({
      accessToken: BUSINESS_TOKEN,
      wabaId: WABA_ID,
      wabaName: "Jasper's Market",
      mode: "standard",
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

  // El `mode` viaja con el target: dejarlo fuera permitiría empezar en
  // Coexistence y terminar registrando.
  it("el modo del target manda sobre lo que le pasen a la segunda mitad", async () => {
    const calls = mockGraph({ phones: () => coexistencePhones() })
    const target = await beginWhatsappSignup(coexistenceInput)
    calls.length = 0

    const result = await finishWhatsappSignup(target, { pin: "998877" })

    expect(calls.map((call) => call.stage)).toEqual(["subscribe", "sync"])
    expect(result.pin).toBeNull()
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

    mockGraph({
      phones: () => coexistencePhones(),
      sync: () => jsonResponse({ success: false }, { status: 400 }),
    })
    await expect(
      completeWhatsappSignup(coexistenceInput)
    ).rejects.toBeInstanceOf(WhatsappApiError)

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

  // Lo mismo para el flujo B y para las operaciones que el flujo no toca: el
  // envío y la media también van con Bearer, nunca con `?access_token=`.
  it("tampoco mete credenciales en el query en Coexistence, envío ni media", async () => {
    const calls = mockGraph({ phones: () => coexistencePhones() })

    await completeWhatsappSignup(coexistenceInput)
    await sendWhatsappMessage({
      accessToken: BUSINESS_TOKEN,
      phoneNumberId: PHONE_NUMBER_ID,
      to: "16315551234",
      message: { text: "hola" },
    })
    await downloadWhatsappMedia(BUSINESS_TOKEN, MEDIA_ID)

    const beyondDebug = calls.filter(
      (call) => call.stage !== "exchange" && call.stage !== "debug"
    )
    for (const call of beyondDebug) {
      expect(call.url).not.toContain("access_token")
      expect(call.url).not.toContain(BUSINESS_TOKEN)
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

  // La versión sube en `lib/meta/graph-version.ts`; si alguien la escribe a mano
  // acá, este canal le habla a Graph distinto que los otros cuatro módulos.
  it("no hardcodea ninguna versión de Graph en el módulo", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./whatsapp-client.ts", import.meta.url)),
      "utf8"
    )

    // La base versionada se importa del módulo central, y **ninguna** versión
    // aparece escrita en este archivo: ni en el código ni en un comentario, que
    // es de donde se copian.
    expect(source).toContain('from "@/lib/meta/graph-version"')
    expect(source).toContain("GRAPH_FACEBOOK_BASE")
    expect(source).not.toMatch(/v\d+\.\d+/)
  })
})

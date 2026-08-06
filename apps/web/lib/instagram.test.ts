import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// El cliente lee las credenciales al importarse, así que hay que sembrarlas
// antes del import. `APP_URL` viene de `lib/meta`, que hace lo mismo.
vi.stubEnv("INSTAGRAM_APP_ID", "ig-app-id")
vi.stubEnv("INSTAGRAM_APP_SECRET", "ig-app-secret")
vi.stubEnv("APP_URL", "https://tunnel.example")

const {
  buildInstagramDialogUrl,
  exchangeCodeForInstagramToken,
  fetchInstagramProfile,
  InstagramApiError,
  INSTAGRAM_REDIRECT_URI,
  INSTAGRAM_SCOPES,
  INSTAGRAM_WEBHOOK_SUBSCRIBED_FIELDS,
  refreshInstagramToken,
  resolveTokenExpiry,
  stripAuthorizationCode,
  subscribeInstagramWebhook,
  unsubscribeInstagramWebhook,
  unwrapInstagramPayload,
} = await import("./instagram")

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })

describe("diálogo de autorización de Instagram", () => {
  it("apunta al host de Instagram y no al de Facebook", () => {
    const url = new URL(buildInstagramDialogUrl("state-1"))

    expect(url.origin).toBe("https://www.instagram.com")
    expect(url.pathname).toBe("/oauth/authorize")
  })

  it("pide los permisos explícitos, porque acá no hay config_id", () => {
    const url = new URL(buildInstagramDialogUrl("state-1"))

    expect(url.searchParams.get("scope")).toBe(INSTAGRAM_SCOPES)
    expect(url.searchParams.get("client_id")).toBe("ig-app-id")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("state")).toBe("state-1")
    expect(url.searchParams.get("config_id")).toBeNull()
  })

  it("usa el redirect_uri de la ruta de Instagram, no el de Facebook", () => {
    expect(INSTAGRAM_REDIRECT_URI).toBe(
      "https://tunnel.example/api/meta/instagram/callback"
    )
    expect(
      new URL(buildInstagramDialogUrl("s")).searchParams.get("redirect_uri")
    ).toBe(INSTAGRAM_REDIRECT_URI)
  })
})

describe("normalización de las respuestas de Instagram", () => {
  it("quita el sufijo #_ que Instagram pega al code", () => {
    expect(stripAuthorizationCode("AQBx123#_")).toBe("AQBx123")
  })

  it("deja intacto un code que ya viene limpio", () => {
    expect(stripAuthorizationCode("AQBx123")).toBe("AQBx123")
  })

  it("no toca un # que esté en el medio del code", () => {
    expect(stripAuthorizationCode("AQ#_Bx")).toBe("AQ#_Bx")
  })

  it("desenvuelve la forma {data:[…]} y también el objeto plano", () => {
    expect(unwrapInstagramPayload({ data: [{ access_token: "t" }] })).toEqual({
      access_token: "t",
    })
    expect(unwrapInstagramPayload({ access_token: "t" })).toEqual({
      access_token: "t",
    })
  })

  it("devuelve un objeto vacío ante una respuesta inservible", () => {
    expect(unwrapInstagramPayload({ data: [] })).toEqual({})
    expect(unwrapInstagramPayload(null)).toEqual({})
    expect(unwrapInstagramPayload("nope")).toEqual({})
  })

  it("convierte expires_in a fecha, en número o en texto", () => {
    const now = new Date("2026-08-05T00:00:00.000Z")

    expect(resolveTokenExpiry(5183944, now)?.toISOString()).toBe(
      "2026-10-03T23:59:04.000Z"
    )
    expect(resolveTokenExpiry("60", now)?.toISOString()).toBe(
      "2026-08-05T00:01:00.000Z"
    )
  })

  // Sin fecha es mejor que con una inventada: una fecha falsa dispararía el
  // refresh a destiempo o lo dejaría dormido para siempre.
  it("no inventa vencimiento cuando expires_in no sirve", () => {
    expect(resolveTokenExpiry(undefined)).toBeNull()
    expect(resolveTokenExpiry(0)).toBeNull()
    expect(resolveTokenExpiry(-1)).toBeNull()
    expect(resolveTokenExpiry("largo")).toBeNull()
  })
})

describe("intercambio del code por un token de larga duración", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("encadena code → token corto → token largo con el secreto de Instagram", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const href = input.toString()
        if (href.startsWith("https://api.instagram.com/oauth/access_token")) {
          return jsonResponse({
            data: [{ access_token: "short", user_id: "1" }],
          })
        }
        return jsonResponse({ access_token: "long", expires_in: 5183944 })
      })

    const token = await exchangeCodeForInstagramToken("AQBx123#_")

    expect(token.accessToken).toBe("long")
    expect(token.expiresAt).toBeInstanceOf(Date)

    const shortBody = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams
    expect(shortBody.get("code")).toBe("AQBx123")
    expect(shortBody.get("grant_type")).toBe("authorization_code")
    expect(shortBody.get("client_secret")).toBe("ig-app-secret")
    expect(shortBody.get("redirect_uri")).toBe(INSTAGRAM_REDIRECT_URI)

    const longUrl = new URL(fetchMock.mock.calls[1]?.[0]?.toString() ?? "")
    expect(longUrl.origin).toBe("https://graph.instagram.com")
    expect(longUrl.searchParams.get("grant_type")).toBe("ig_exchange_token")
    expect(longUrl.searchParams.get("access_token")).toBe("short")
  })

  // Guardar el token corto dejaría la cuenta conectada y muda en una hora, sin
  // ninguna señal de por qué.
  it("falla explícito si el paso al token largo no responde", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const href = input.toString()
      if (href.startsWith("https://api.instagram.com/oauth/access_token")) {
        return jsonResponse({ data: [{ access_token: "short" }] })
      }
      return jsonResponse({ error: { message: "nope" } }, { status: 400 })
    })

    await expect(exchangeCodeForInstagramToken("code")).rejects.toMatchObject({
      name: "InstagramApiError",
      step: "long_lived_token",
    })
  })

  it("marca el paso corto cuando Instagram rechaza el code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error_message: "invalid code" }, { status: 400 })
    )

    await expect(exchangeCodeForInstagramToken("code")).rejects.toMatchObject({
      step: "short_lived_token",
    })
  })

  it("renueva un token largo por otros ~60 días", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({ access_token: "renewed", expires_in: 5183944 })
      )

    const token = await refreshInstagramToken("old")

    expect(token.accessToken).toBe("renewed")
    const url = new URL(fetchMock.mock.calls[0]?.[0]?.toString() ?? "")
    expect(url.pathname).toBe("/refresh_access_token")
    expect(url.searchParams.get("grant_type")).toBe("ig_refresh_token")
  })
})

describe("perfil de la cuenta de Instagram", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // `user_id` es el IG ID de la cuenta profesional y es el que llega como
  // `entry.id` en el webhook; `id` es app-scoped y no sirve para resolver
  // cuenta→tenant.
  it("se queda con user_id y no con el id app-scoped", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "app-scoped-999",
            user_id: "17841400000000000",
            username: "resender",
            name: "Resender",
          },
        ],
      })
    )

    const profile = await fetchInstagramProfile("token")

    expect(profile).toEqual({
      igUserId: "17841400000000000",
      username: "resender",
      name: "Resender",
    })

    const url = new URL(fetchMock.mock.calls[0]?.[0]?.toString() ?? "")
    expect(url.origin).toBe("https://graph.instagram.com")
    expect(url.searchParams.get("fields")).toContain("user_id")
  })

  it("acepta una cuenta sin nombre visible", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ user_id: "178414", username: "resender" })
    )

    await expect(fetchInstagramProfile("token")).resolves.toMatchObject({
      name: null,
    })
  })

  it("falla si Instagram no devuelve el user_id", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: [{ id: "app-scoped-999", username: "resender" }] })
    )

    await expect(fetchInstagramProfile("token")).rejects.toBeInstanceOf(
      InstagramApiError
    )
  })
})

describe("suscripción al webhook de Instagram", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("suscribe la cuenta a mensajes y comentarios sobre /me", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ success: true }))

    await expect(subscribeInstagramWebhook("token")).resolves.toBeUndefined()

    // Sin id en el path: el token ya identifica a la cuenta.
    expect(fetchMock.mock.calls[0]?.[0]?.toString()).toContain(
      "graph.instagram.com/v23.0/me/subscribed_apps"
    )
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams
    expect(body.get("subscribed_fields")).toBe(
      INSTAGRAM_WEBHOOK_SUBSCRIBED_FIELDS
    )
  })

  it("lanza cuando Meta no confirma la suscripción", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ success: false })
    )

    await expect(subscribeInstagramWebhook("token")).rejects.toMatchObject({
      step: "subscribe",
    })
  })

  // Best-effort: los dos llamadores (desconectar y borrar la cuenta) siguen
  // adelante igual, así que devuelve el resultado en vez de lanzar.
  it("desuscribe devolviendo si Meta lo confirmó, sin lanzar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ success: true }))

    await expect(unsubscribeInstagramWebhook("token")).resolves.toBe(true)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("DELETE")
    // El token va en query: el body de un DELETE se pierde en varios stacks.
    expect(fetchMock.mock.calls[0]?.[0]?.toString()).toContain(
      "access_token=token"
    )

    fetchMock.mockResolvedValue(jsonResponse({}, { status: 400 }))
    await expect(unsubscribeInstagramWebhook("token")).resolves.toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  beginWhatsappSignup: vi.fn(),
  connectWhatsappNumber: vi.fn(),
  cookies: vi.fn(),
  countActivePages: vi.fn(),
  finishWhatsappSignup: vi.fn(),
  getSubscriptionByTenantId: vi.fn(),
  hasActiveSubscription: vi.fn(),
  isUserWaitlisted: vi.fn(),
  redirect: vi.fn(),
  resolveWhatsappNumberOwnership: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

vi.mock("@/auth", () => ({
  auth: mocks.auth,
}))

vi.mock("@/lib/auth/waitlist", () => ({
  isUserWaitlisted: mocks.isUserWaitlisted,
}))

vi.mock("@/lib/billing/subscription", () => ({
  getSubscriptionByTenantId: mocks.getSubscriptionByTenantId,
  hasActiveSubscription: mocks.hasActiveSubscription,
}))

vi.mock("@/lib/crypto/encryption", () => {
  class SecretEncryptionConfigError extends Error {}

  return {
    assertSecretEncryptionConfigured: () => {},
    SecretEncryptionConfigError,
  }
})

vi.mock("@/lib/pages/page-registry", () => {
  class PageOwnershipError extends Error {
    constructor(readonly metaPageId: string) {
      super("page already belongs to another tenant")
    }
  }

  return {
    connectWhatsappNumber: mocks.connectWhatsappNumber,
    countActivePages: mocks.countActivePages,
    resolveWhatsappNumberOwnership: mocks.resolveWhatsappNumberOwnership,
    PageOwnershipError,
  }
})

// Solo las dos mitades que hablan con Meta. `normalizeWhatsappPin` y
// `WhatsappApiError` son los de verdad: uno es la validación que se está
// probando y el otro es el tipo por el que se ramifica el manejo de errores, y
// una copia de cualquiera de los dos probaría la copia.
vi.mock("@/lib/whatsapp", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/whatsapp")>("@/lib/whatsapp")

  return {
    ...actual,
    beginWhatsappSignup: mocks.beginWhatsappSignup,
    finishWhatsappSignup: mocks.finishWhatsappSignup,
  }
})

vi.mock("@/lib/posthog", () => ({
  posthog: null,
}))

import { PageOwnershipError } from "@/lib/pages/page-registry"
import { WhatsappApiError } from "@/lib/whatsapp"

import {
  connectWhatsappNumberAction,
  issueWhatsappSignupNonce,
} from "./actions"

const NONCE_COOKIE = "whatsapp_signup_nonce"

// Almacén de cookies del request, compartido entre la emisión del nonce y su
// consumo: es justo el ida y vuelta que hay que probar, así que el fake guarda
// estado en vez de devolver valores fijos.
const jar = new Map<string, string>()
const cookieWrites: { name: string; value: string; options: unknown }[] = []

const cookieStore = {
  get: (name: string) => {
    const value = jar.get(name)
    return value === undefined ? undefined : { name, value }
  },
  set: (name: string, value: string, options: unknown) => {
    jar.set(name, value)
    cookieWrites.push({ name, value, options })
  },
  delete: (name: string) => {
    jar.delete(name)
  },
}

// Lo que devuelve la mitad reversible: todo confirmado contra Graph y nada
// tocado todavía en Meta.
const signupTarget = {
  accessToken: "business-token",
  tokenExpiresAt: new Date("2026-10-12T00:00:00.000Z"),
  wabaId: "102030405060708",
  wabaName: "Vetta",
  phone: {
    id: "109876543210987",
    displayPhoneNumber: "+52 1 55 1234 5678",
    phoneE164: "+5215512345678",
    verifiedName: "Vetta Clínica",
  },
}

const signupResult = {
  accessToken: "business-token",
  tokenExpiresAt: signupTarget.tokenExpiresAt,
  wabaId: "102030405060708",
  wabaName: "Vetta",
  phoneNumberId: "109876543210987",
  phoneE164: "+5215512345678",
  verifiedName: "Vetta Clínica",
  pin: "042713",
  pinGenerated: true,
  onboardingMode: "standard" as const,
}

const connectedPage = {
  id: "connection-1",
  tenantId: "tenant-1",
  channel: "whatsapp" as const,
  metaPageId: "109876543210987",
  name: "Vetta Clínica",
  username: null,
  wabaId: "102030405060708",
  phoneE164: "+5215512345678",
}

const unclaimedNumber = {
  ownedByOtherTenant: false,
  activeForTenant: false,
  storedPin: null,
}

// El launcher pide el nonce al montarse y lo manda de vuelta con el `code`.
async function signupForm(
  overrides: Record<string, string> = {}
): Promise<FormData> {
  const issued = await issueWhatsappSignupNonce()

  const formData = new FormData()
  formData.set("nonce", issued.nonce ?? "")
  formData.set("code", "AQD-embedded-signup-code")
  formData.set("wabaId", "102030405060708")
  formData.set("phoneNumberId", "109876543210987")
  for (const [key, value] of Object.entries(overrides)) {
    formData.set(key, value)
  }
  return formData
}

describe("connect-whatsapp actions", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    jar.clear()
    cookieWrites.length = 0

    mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(true)
    mocks.cookies.mockResolvedValue(cookieStore)
    // Plan Starter: dos páginas de Facebook y números de WhatsApp, ninguna
    // ocupada todavía.
    mocks.getSubscriptionByTenantId.mockResolvedValue({
      priceLookupKey: "starter_monthly",
    })
    mocks.countActivePages.mockResolvedValue(0)
    mocks.resolveWhatsappNumberOwnership.mockResolvedValue(unclaimedNumber)
    mocks.beginWhatsappSignup.mockResolvedValue(signupTarget)
    mocks.finishWhatsappSignup.mockResolvedValue(signupResult)
    mocks.connectWhatsappNumber.mockResolvedValue(connectedPage)

    // El log estructurado escribe por consola en cada camino; acá solo estorba.
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("issueWhatsappSignupNonce", () => {
    it("seeds an httpOnly cookie bound to the tenant", async () => {
      const issued = await issueWhatsappSignupNonce()

      expect(issued.nonce).toBeTruthy()
      expect(cookieWrites).toHaveLength(1)
      expect(cookieWrites[0]).toMatchObject({
        name: NONCE_COOKIE,
        // El tenant va delante del nonce: la cookie sobrevive a un cambio de
        // sesión en el mismo navegador y sin esa atadura serviría para cerrar
        // el onboarding de la cuenta siguiente.
        value: `tenant-1.${issued.nonce}`,
        options: { httpOnly: true, secure: true, sameSite: "lax" },
      })
    })

    it("does not hand a nonce to someone who could not connect anyway", async () => {
      mocks.auth.mockResolvedValue(null)
      await expect(issueWhatsappSignupNonce()).resolves.toEqual({
        error: "No has iniciado sesión.",
      })

      mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
      mocks.isUserWaitlisted.mockResolvedValue(true)
      await expect(issueWhatsappSignupNonce()).resolves.toEqual({
        error: "Tu cuenta está en la lista de espera.",
      })

      mocks.isUserWaitlisted.mockResolvedValue(false)
      mocks.hasActiveSubscription.mockResolvedValue(false)
      await expect(issueWhatsappSignupNonce()).resolves.toEqual({
        error: "Tu suscripción no está activa.",
      })

      expect(cookieWrites).toHaveLength(0)
    })
  })

  describe("connectWhatsappNumberAction", () => {
    it("persists what Graph confirmed and sends the user back with the number", async () => {
      await connectWhatsappNumberAction({}, await signupForm())

      expect(mocks.beginWhatsappSignup).toHaveBeenCalledWith({
        code: "AQD-embedded-signup-code",
        hint: {
          wabaId: "102030405060708",
          phoneNumberId: "109876543210987",
        },
      })
      expect(mocks.finishWhatsappSignup).toHaveBeenCalledWith(signupTarget, {})
      // Los identificadores que se guardan son los que devolvió el cliente tras
      // confirmarlos contra Graph, no los que dijo el navegador.
      expect(mocks.connectWhatsappNumber).toHaveBeenCalledWith("tenant-1", {
        phoneNumberId: "109876543210987",
        wabaId: "102030405060708",
        wabaName: "Vetta",
        phoneE164: "+5215512345678",
        verifiedName: "Vetta Clínica",
        accessToken: "business-token",
        tokenExpiresAt: signupResult.tokenExpiresAt,
        pin: "042713",
        // El PIN lo generamos nosotros: es el único caso que hay que poder
        // devolverle al cliente desde la tarjeta de Conexiones.
        pinOrigin: "generated",
        onboardingMode: "standard",
      })
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/connections")
      expect(mocks.redirect).toHaveBeenCalledWith(
        "/connections?whatsapp=connected&phone=%2B5215512345678"
      )
    })

    it("omits the phone from the redirect when Meta did not report one", async () => {
      mocks.connectWhatsappNumber.mockResolvedValue({
        ...connectedPage,
        phoneE164: null,
      })

      await connectWhatsappNumberAction({}, await signupForm())

      expect(mocks.redirect).toHaveBeenCalledWith(
        "/connections?whatsapp=connected"
      )
    })

    // -----------------------------------------------------------------------
    // Cupo del plan
    // -----------------------------------------------------------------------

    // El daño no se ve en WhatsApp: al pasarse del cupo, el entitlement entero
    // cae en `page_limit_exceeded` y las páginas de Messenger que ya andaban
    // dejan de entregar. Por eso la puerta está **antes** de tocar Meta: un
    // número registrado y suscrito que no se puede guardar sería peor todavía.
    it("refuses to connect a number when the plan has no room left, without touching Meta", async () => {
      mocks.countActivePages.mockResolvedValue(2)

      const result = await connectWhatsappNumberAction({}, await signupForm())

      expect(result.error).toBe(
        "Tu plan permite 2 páginas de Facebook y números de WhatsApp conectados, y ya tienes 2 activos. Desconecta uno en Conexiones para liberar un hueco y vuelve a lanzar la conexión."
      )
      expect(mocks.beginWhatsappSignup).not.toHaveBeenCalled()
      expect(mocks.finishWhatsappSignup).not.toHaveBeenCalled()
      expect(mocks.connectWhatsappNumber).not.toHaveBeenCalled()
    })

    // Reconectar no pide un hueco nuevo: el número ya ocupa el suyo. Sin esta
    // excepción, quien está al límite no podría renovarle el token a un número
    // que ya tiene conectado.
    it("lets a tenant at the limit reconnect a number that is already active", async () => {
      mocks.countActivePages.mockResolvedValue(2)
      mocks.resolveWhatsappNumberOwnership.mockResolvedValue({
        ownedByOtherTenant: false,
        activeForTenant: true,
        storedPin: "042713",
      })

      await connectWhatsappNumberAction({}, await signupForm())

      expect(mocks.finishWhatsappSignup).toHaveBeenCalled()
      expect(mocks.redirect).toHaveBeenCalledWith(
        "/connections?whatsapp=connected&phone=%2B5215512345678"
      )
    })

    it("fails closed when the plan limits cannot be resolved", async () => {
      mocks.getSubscriptionByTenantId.mockResolvedValue(null)

      const result = await connectWhatsappNumberAction({}, await signupForm())

      expect(result.error).toContain("los límites de tu plan")
      expect(mocks.beginWhatsappSignup).not.toHaveBeenCalled()
    })

    // -----------------------------------------------------------------------
    // Propiedad del número, antes de las llamadas irreversibles
    // -----------------------------------------------------------------------

    // `/register` activa la verificación en dos pasos con el PIN que le
    // mandemos y no hay endpoint que la deshaga. Comprobar la propiedad después
    // —dentro del escritor, como estaba— dejaba obsoleto el PIN del dueño
    // legítimo y le registraba el número a nombre del intruso.
    it("rejects another tenant's number before subscribing or registering", async () => {
      mocks.resolveWhatsappNumberOwnership.mockResolvedValue({
        ownedByOtherTenant: true,
        activeForTenant: false,
        storedPin: null,
      })

      await connectWhatsappNumberAction({}, await signupForm())

      // La propiedad se consulta con el id que confirmó Graph, no con el que
      // dijo el navegador.
      expect(mocks.resolveWhatsappNumberOwnership).toHaveBeenCalledWith(
        "tenant-1",
        "109876543210987"
      )
      expect(mocks.finishWhatsappSignup).not.toHaveBeenCalled()
      expect(mocks.connectWhatsappNumber).not.toHaveBeenCalled()
      expect(mocks.redirect).toHaveBeenCalledWith(
        "/connections?whatsapp=error&reason=whatsapp_number_owned%3A109876543210987"
      )
    })

    // No poder confirmar de quién es el número no es lo mismo que que sea tuyo:
    // sin respuesta de la base, el onboarding se corta antes de registrar.
    it("aborts instead of registering when the ownership lookup fails", async () => {
      // La primera lectura es la del cupo, que ya pasó; la que se cae es la del
      // veredicto de propiedad, con el `code` ya canjeado.
      mocks.resolveWhatsappNumberOwnership
        .mockResolvedValueOnce(unclaimedNumber)
        .mockRejectedValue(new Error("neon is down"))

      await connectWhatsappNumberAction({}, await signupForm())

      expect(mocks.beginWhatsappSignup).toHaveBeenCalled()
      expect(mocks.finishWhatsappSignup).not.toHaveBeenCalled()
      expect(mocks.redirect).toHaveBeenCalledWith(
        "/connections?whatsapp=error&reason=whatsapp_persist_failed"
      )
    })

    // Y si lo que se cae es la lectura del cupo, tampoco se toca Meta: el
    // usuario ve un mensaje en el botón, no la pantalla de error de Next.
    it("fails closed with a message when the plan slot check cannot be read", async () => {
      mocks.countActivePages.mockRejectedValue(new Error("neon is down"))

      const result = await connectWhatsappNumberAction({}, await signupForm())

      expect(result.error).toContain("cupo de tu plan")
      expect(mocks.beginWhatsappSignup).not.toHaveBeenCalled()
    })

    // -----------------------------------------------------------------------
    // El PIN
    // -----------------------------------------------------------------------

    // Reconexión: el número ya lo registramos nosotros, así que la verificación
    // en dos pasos está activa con nuestro PIN y `/register` lo vuelve a pedir.
    // Es el mismo camino que salva un reintento después de una escritura
    // fallida: la fila y su PIN siguen ahí, y el segundo intento reusa ese PIN
    // en vez de generar otro, que es lo que devolvería un 133005 pidiéndole al
    // cliente un PIN que nos inventamos nosotros.
    it("reuses the stored PIN on a retry instead of generating a new one", async () => {
      mocks.resolveWhatsappNumberOwnership.mockResolvedValue({
        ownedByOtherTenant: false,
        activeForTenant: true,
        storedPin: "042713",
      })
      mocks.connectWhatsappNumber.mockRejectedValueOnce(new Error("neon is down"))

      // Primer intento: todo bien en Meta, la escritura se cae.
      await connectWhatsappNumberAction({}, await signupForm())
      expect(mocks.redirect).toHaveBeenCalledWith(
        "/connections?whatsapp=error&reason=whatsapp_persist_failed"
      )

      // Reintento: el PIN guardado se reusa tal cual.
      await connectWhatsappNumberAction({}, await signupForm())

      for (const call of mocks.finishWhatsappSignup.mock.calls) {
        expect(call[1]).toEqual({ pin: "042713" })
      }
      expect(mocks.connectWhatsappNumber).toHaveBeenLastCalledWith(
        "tenant-1",
        // El origen no se toca en una reconexión: el PIN sigue siendo el que
        // generamos nosotros, y marcarlo como del cliente lo escondería de la
        // tarjeta justo cuando más falta hace.
        expect.objectContaining({ pin: "042713", pinOrigin: "stored" })
      )
    })

    // Quien copia el PIN de la propia tarjeta y lo vuelve a escribir no está
    // aportando uno suyo: el PIN sigue siendo el que generamos nosotros, así
    // que la marca no se toca y la tarjeta lo sigue enseñando.
    it("keeps the origin when the customer types back the PIN we generated", async () => {
      mocks.resolveWhatsappNumberOwnership.mockResolvedValue({
        ownedByOtherTenant: false,
        activeForTenant: true,
        storedPin: "042713",
      })

      await connectWhatsappNumberAction({}, await signupForm({ pin: "042713" }))

      expect(mocks.connectWhatsappNumber).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ pinOrigin: "stored" })
      )
    })

    it("prefers the PIN the customer typed over the stored one", async () => {
      mocks.resolveWhatsappNumberOwnership.mockResolvedValue({
        ownedByOtherTenant: false,
        activeForTenant: false,
        storedPin: "042713",
      })
      mocks.finishWhatsappSignup.mockResolvedValue({
        ...signupResult,
        pin: "998877",
        pinGenerated: false,
      })

      await connectWhatsappNumberAction({}, await signupForm({ pin: "998877" }))

      expect(mocks.finishWhatsappSignup).toHaveBeenCalledWith(signupTarget, {
        pin: "998877",
      })
      expect(mocks.connectWhatsappNumber).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ pin: "998877", pinOrigin: "customer" })
      )
    })

    // El `maxLength={6}` del input es decoración y esta acción se puede invocar
    // por POST directo. Sin validar, un pegado con basura salía como
    // `registration_failed` y mandaba al cliente a revisar si su número está en
    // uso en otra plataforma, que no tiene nada que ver.
    it("rejects a PIN that is not six digits, and keeps the field on screen", async () => {
      const result = await connectWhatsappNumberAction(
        {},
        await signupForm({ pin: "04-27-13" })
      )

      expect(result.pinRequired).toBe(true)
      expect(result.error).toContain("6 dígitos")
      expect(mocks.beginWhatsappSignup).not.toHaveBeenCalled()
    })

    it("accepts a PIN pasted with spaces", async () => {
      mocks.finishWhatsappSignup.mockResolvedValue({
        ...signupResult,
        pin: "998877",
        pinGenerated: false,
      })

      await connectWhatsappNumberAction({}, await signupForm({ pin: "99 88 77" }))

      expect(mocks.finishWhatsappSignup).toHaveBeenCalledWith(signupTarget, {
        pin: "998877",
      })
    })

    // -----------------------------------------------------------------------
    // El nonce
    // -----------------------------------------------------------------------

    // El nonce sustituye a la cookie de `state` que protege a Messenger: al
    // pasar de redirect OAuth a popup no hay navegación de vuelta donde
    // compararlo, y sin él cualquier POST cerraría el onboarding con un `code`
    // ajeno.
    it("rejects a nonce that was never issued, without touching Meta", async () => {
      const formData = await signupForm({ nonce: "no-lo-emitimos-nosotros" })

      const result = await connectWhatsappNumberAction({}, formData)

      // El mensaje nombra la causa probable —otra pestaña de Conexiones pisó el
      // nonce— porque el usuario que lo lee ya completó el Embedded Signup
      // entero y el genérico «la sesión venció» no le dice qué hacer.
      expect(result.error).toBe(
        "No se pudo conectar: la autorización no coincide con esta pestaña. Suele pasar cuando Conexiones quedó abierta en otra pestaña o ventana, porque la segunda invalida la conexión que empezó la primera. Cierra las demás y vuelve a lanzarla desde una sola."
      )

      expect(mocks.beginWhatsappSignup).not.toHaveBeenCalled()
      expect(mocks.redirect).not.toHaveBeenCalled()
    })

    it("rejects a nonce issued for another tenant's session", async () => {
      const formData = await signupForm()
      mocks.auth.mockResolvedValue({ user: { id: "tenant-2" } })

      const result = await connectWhatsappNumberAction({}, formData)

      expect(result.error).toContain("No se pudo conectar")
      expect(mocks.beginWhatsappSignup).not.toHaveBeenCalled()
    })

    it("burns the nonce on the first use, successful or not", async () => {
      const formData = await signupForm()
      await connectWhatsappNumberAction({}, formData)
      expect(mocks.beginWhatsappSignup).toHaveBeenCalledTimes(1)

      // Segundo intento con el mismo nonce: la cookie ya no está.
      const replay = await connectWhatsappNumberAction({}, formData)

      expect(replay.error).toContain("No se pudo conectar")
      expect(mocks.beginWhatsappSignup).toHaveBeenCalledTimes(1)
      expect(jar.has(NONCE_COOKIE)).toBe(false)
    })

    it("consumes the nonce even when the rest of the form is missing", async () => {
      const formData = await signupForm()
      formData.delete("code")

      const result = await connectWhatsappNumberAction({}, formData)

      expect(result.error).toBe(
        "No se pudo conectar: la autorización volvió incompleta. Vuelve a lanzarla desde el botón."
      )
      expect(jar.has(NONCE_COOKIE)).toBe(false)
      expect(mocks.beginWhatsappSignup).not.toHaveBeenCalled()
    })

    // -----------------------------------------------------------------------
    // Desenlaces
    // -----------------------------------------------------------------------

    // Un paso, un motivo: la convención `whatsapp_<step>_failed` del catálogo
    // existe para que este mapeo sea una plantilla y no una tabla que se
    // desincroniza cuando el cliente gana un paso.
    it("maps every failed step to its own reason in the Connections banner", async () => {
      const steps = ["exchange", "assets"] as const

      for (const step of steps) {
        mocks.redirect.mockClear()
        mocks.beginWhatsappSignup.mockRejectedValue(
          new WhatsappApiError(`${step} failed`, step, "network_error")
        )

        await connectWhatsappNumberAction({}, await signupForm())

        expect(mocks.redirect).toHaveBeenCalledWith(
          `/connections?whatsapp=error&reason=whatsapp_${step}_failed`
        )
      }

      for (const step of ["subscribe", "register"] as const) {
        mocks.redirect.mockClear()
        mocks.beginWhatsappSignup.mockResolvedValue(signupTarget)
        mocks.finishWhatsappSignup.mockRejectedValue(
          new WhatsappApiError(`${step} failed`, step, "network_error")
        )

        await connectWhatsappNumberAction({}, await signupForm())

        expect(mocks.redirect).toHaveBeenCalledWith(
          `/connections?whatsapp=error&reason=whatsapp_${step}_failed`
        )
      }
    })

    it("reports a failed write as the persist step", async () => {
      mocks.connectWhatsappNumber.mockRejectedValue(new Error("neon is down"))

      await connectWhatsappNumberAction({}, await signupForm())

      expect(mocks.redirect).toHaveBeenCalledWith(
        "/connections?whatsapp=error&reason=whatsapp_persist_failed"
      )
    })

    // 133005: el número ya tenía verificación en dos pasos. Es el único fallo
    // cuyo remedio está en el propio botón —aportar el PIN y volver a lanzar—,
    // así que vuelve como estado y no como aviso de la pantalla.
    it("asks for the customer's PIN when the number already has two-step verification", async () => {
      mocks.finishWhatsappSignup.mockRejectedValue(
        new WhatsappApiError(
          "phone number already has a two-step verification pin",
          "register",
          "pin_required",
          133005
        )
      )

      const result = await connectWhatsappNumberAction({}, await signupForm())

      expect(result.pinRequired).toBe(true)
      expect(result.error).toBe(
        "No se pudo conectar: el número ya tiene la verificación en dos pasos activada. Vuelve a lanzar la conexión indicando su PIN de seis dígitos, o desactívala desde WhatsApp Manager e inténtalo de nuevo."
      )
      expect(mocks.redirect).not.toHaveBeenCalled()
    })

    // El escritor sigue lanzando el mismo error cuando pierde la carrera contra
    // otro tenant (la violación de unicidad se traduce a esto), así que este
    // camino también lo cubre.
    it("names the number when the writer says it belongs to another tenant", async () => {
      mocks.connectWhatsappNumber.mockRejectedValue(
        new PageOwnershipError("109876543210987")
      )

      await connectWhatsappNumberAction({}, await signupForm())

      expect(mocks.redirect).toHaveBeenCalledWith(
        "/connections?whatsapp=error&reason=whatsapp_number_owned%3A109876543210987"
      )
    })

    // La action se puede invocar por POST directo, sin pasar por el layout de
    // `(product)`: los gates tienen que estar acá también.
    it("answers in Spanish and touches nothing when a gate blocks the tenant", async () => {
      const formData = await signupForm()

      mocks.auth.mockResolvedValue(null)
      await expect(connectWhatsappNumberAction({}, formData)).resolves.toEqual({
        error: "No has iniciado sesión.",
      })

      mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
      mocks.isUserWaitlisted.mockResolvedValue(true)
      await expect(connectWhatsappNumberAction({}, formData)).resolves.toEqual({
        error: "Tu cuenta está en la lista de espera.",
      })

      mocks.isUserWaitlisted.mockResolvedValue(false)
      mocks.hasActiveSubscription.mockResolvedValue(false)
      await expect(connectWhatsappNumberAction({}, formData)).resolves.toEqual({
        error: "Tu suscripción no está activa.",
      })

      expect(mocks.beginWhatsappSignup).not.toHaveBeenCalled()
      expect(mocks.connectWhatsappNumber).not.toHaveBeenCalled()
      // El nonce sigue vivo: un gate no es un intento de cerrar el onboarding.
      expect(jar.has(NONCE_COOKIE)).toBe(true)
    })
  })
})

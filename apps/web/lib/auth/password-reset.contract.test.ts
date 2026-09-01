import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { resetTokenIdentifier } from "@/lib/auth/password-reset"

// **El test más importante de la entrega.**
//
// `lib/auth/password-reset.ts` cablea dos detalles internos de Better Auth
// —que el identifier de la fila sea `reset-password:<token>` y que su `value`
// sea el `users.id`— y nada más los vigila: si la librería cambia el formato,
// el peek diría "el enlace venció" sobre un token perfectamente bueno, en
// silencio y sin que ningún otro test se ponga rojo.
//
// Mismo patrón y misma justificación que `lib/auth/set-password.test.ts`:
// instancia **real** de `betterAuth()` con el adaptador en memoria. Va en un
// archivo aparte del de `peekResetToken` porque ese otro mockea `@/lib/db` y
// acá no hay base que mockear.

type VerificationRow = {
  identifier: string
  value: string
  expiresAt: Date
}

const db: Record<string, Record<string, unknown>[]> = {
  user: [],
  session: [],
  account: [],
  verification: [],
}

// Tipada con la forma que la librería le pasa al callback, para poder leer el
// `token` sin castear en cada test.
const sendResetPassword = vi.fn<
  (data: {
    user: { id: string; email: string }
    url: string
    token: string
  }) => Promise<void>
>(async () => {})

const auth = betterAuth({
  secret: "test-secret-para-el-adaptador-en-memoria-0123456789",
  baseURL: "http://localhost:3000",
  database: memoryAdapter(db),
  emailAndPassword: {
    enabled: true,
    sendResetPassword,
    // Los tres valores que `lib/auth/auth.ts` configura y que esta entrega
    // depende de que la librería honre.
    resetPasswordTokenExpiresIn: 3600,
    revokeSessionsOnPasswordReset: true,
  },
  advanced: { database: { generateId: () => crypto.randomUUID() } },
})

function verifications(): VerificationRow[] {
  return db.verification as unknown as VerificationRow[]
}

async function signUp(email: string) {
  return auth.api.signUpEmail({
    body: { name: "Ada Lovelace", email, password: "contraseña-inicial" },
  })
}

beforeEach(() => {
  sendResetPassword.mockClear()
})

describe("contrato de recuperación con better-auth", () => {
  it("guarda el token con el identifier y el value que asume el peek", async () => {
    const created = await signUp("ada@example.com")

    await auth.api.requestPasswordReset({
      body: { email: "ada@example.com", redirectTo: "/reset-password" },
    })

    expect(sendResetPassword).toHaveBeenCalledTimes(1)
    const token = sendResetPassword.mock.calls[0]![0].token
    expect(token).toBeTruthy()

    // Las dos suposiciones de `lib/auth/password-reset.ts`, una por línea.
    const row = verifications().find(
      (v) => v.identifier === resetTokenIdentifier(token)
    )
    expect(row).toBeDefined()
    expect(row!.value).toBe(created.user.id)
    // Y la hora de vida que promete [Enlace de recuperacion].
    const ttlMs = row!.expiresAt.getTime() - Date.now()
    expect(ttlMs).toBeGreaterThan(3500_000)
    expect(ttlMs).toBeLessThanOrEqual(3600_000)
  })

  it("cambia la credencial y consume el token: el segundo uso falla", async () => {
    await signUp("grace@example.com")
    await auth.api.requestPasswordReset({
      body: { email: "grace@example.com", redirectTo: "/reset-password" },
    })
    const token = sendResetPassword.mock.calls[0]![0].token

    await auth.api.resetPassword({
      body: { newPassword: "contraseña-recuperada", token },
    })

    // La credencial nueva entra.
    await expect(
      auth.api.signInEmail({
        body: { email: "grace@example.com", password: "contraseña-recuperada" },
      })
    ).resolves.toBeTruthy()

    // Y el enlace sirve **una sola vez**.
    await expect(
      auth.api.resetPassword({
        body: { newPassword: "otra-contraseña-mas", token },
      })
    ).rejects.toThrow()
  })

  it("revoca TODAS las sesiones abiertas, no solo las otras", async () => {
    const created = await signUp("hedy@example.com")
    // Dos sesiones más, como dos dispositivos: una de ellas es la de quien
    // entró sin permiso, que es el caso que la feature existe para arreglar.
    await auth.api.signInEmail({
      body: { email: "hedy@example.com", password: "contraseña-inicial" },
    })
    await auth.api.signInEmail({
      body: { email: "hedy@example.com", password: "contraseña-inicial" },
    })
    expect(
      db.session!.filter((s) => s.userId === created.user.id).length
    ).toBeGreaterThan(1)

    await auth.api.requestPasswordReset({
      body: { email: "hedy@example.com", redirectTo: "/reset-password" },
    })
    const token = sendResetPassword.mock.calls[0]![0].token
    await auth.api.resetPassword({
      body: { newPassword: "contraseña-recuperada", token },
    })

    expect(
      db.session!.filter((s) => s.userId === created.user.id)
    ).toHaveLength(0)
  })

  it("no manda correo para un email que no tiene cuenta", async () => {
    // La propiedad de no-oráculo, y la más fácil de romper con un refactor
    // bienintencionado. La librería responde 200 igual.
    await expect(
      auth.api.requestPasswordReset({
        body: { email: "nadie@example.com", redirectTo: "/reset-password" },
      })
    ).resolves.toMatchObject({ status: true })

    expect(sendResetPassword).not.toHaveBeenCalled()
  })
})

import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { beforeAll, describe, expect, it } from "vitest"

import { applyPasswordToCredential } from "@/lib/auth/set-password"

// **Este test existe para que un bump de `better-auth` no rompa el cambio de
// contraseña en silencio.**
//
// `lib/auth/set-password.ts` es el único archivo del repo que toca
// `ctx.internalAdapter`, que es API interna y cuya superficie cambió entre
// minors. Acá se corre contra una instancia **real** de la librería —con el
// adaptador en memoria, sin base de datos— así que si `findCredentialAccount`,
// `updatePassword`, `createAccount` o `password.hash` cambian de nombre, de
// firma o de semántica, esto falla y señala el único archivo que hay que tocar.
//
// Y de paso fija lo que la investigación descartó: `updatePassword` **no crea**
// la credencial si no existe y tampoco falla, así que sin el
// `findCredentialAccount` previo el cambio sería un no-op silencioso.

// La forma que este test necesita del contexto real. Pasarlo a
// `applyPasswordToCredential` obliga a que siga encajando en el parámetro que
// esa función declara: si el módulo cambia lo que pide, esto deja de compilar.
type CredentialRow = {
  userId: string
  accountId: string
  providerId: string
  issuer: string
  password?: string | null
}

type Ctx = {
  password: {
    hash: (password: string) => Promise<string>
    verify: (input: { password: string; hash: string }) => Promise<boolean>
  }
  internalAdapter: {
    createUser: (user: Record<string, unknown>) => Promise<{ id: string }>
    findCredentialAccount: (userId: string) => Promise<CredentialRow | null>
    updatePassword: (userId: string, password: string) => Promise<unknown>
    createAccount: (account: {
      userId: string
      providerId: string
      issuer: string
      accountId: string
      password: string
    }) => Promise<unknown>
  }
}

const db: Record<string, Record<string, unknown>[]> = {
  user: [],
  session: [],
  account: [],
  verification: [],
}

const auth = betterAuth({
  // El secreto es de juguete a propósito: en `NODE_ENV=test` la librería solo
  // advierte, y lo que se prueba acá no es la criptografía sino la superficie.
  secret: "test-secret-para-el-adaptador-en-memoria-0123456789",
  baseURL: "http://localhost:3000",
  database: memoryAdapter(db),
  emailAndPassword: { enabled: true },
  advanced: { database: { generateId: () => crypto.randomUUID() } },
})

let ctx: Ctx
let userId: string

beforeAll(async () => {
  ctx = (await auth.$context) as unknown as Ctx
  const user = await ctx.internalAdapter.createUser({
    email: "ada@example.com",
    name: "Ada Lovelace",
    emailVerified: false,
  })
  userId = user.id
})

describe("applyPasswordToCredential", () => {
  it("crea la credencial cuando la cuenta todavía no tiene ninguna", async () => {
    expect(await ctx.internalAdapter.findCredentialAccount(userId)).toBeNull()

    await applyPasswordToCredential(ctx, userId, "contraseña-inicial")

    const account = await ctx.internalAdapter.findCredentialAccount(userId)
    expect(account).not.toBeNull()
    // Guarda el **hash**, nunca el texto plano.
    expect(account?.password).not.toBe("contraseña-inicial")
    expect(
      await ctx.password.verify({
        password: "contraseña-inicial",
        hash: account!.password!,
      })
    ).toBe(true)
  })

  it("reemplaza la contraseña de una credencial que ya existe", async () => {
    // Este es el caso que `auth.api.setPassword` **no** cubre: con una
    // contraseña ya seteada tira `PASSWORD_ALREADY_SET`.
    await applyPasswordToCredential(ctx, userId, "contraseña-nueva")

    const account = await ctx.internalAdapter.findCredentialAccount(userId)
    expect(
      await ctx.password.verify({
        password: "contraseña-nueva",
        hash: account!.password!,
      })
    ).toBe(true)
    expect(
      await ctx.password.verify({
        password: "contraseña-inicial",
        hash: account!.password!,
      })
    ).toBe(false)
  })

  it("no deja una segunda credencial del mismo proveedor", async () => {
    const accounts = db.account!.filter(
      (row) => row.userId === userId && row.providerId === "credential"
    )
    expect(accounts).toHaveLength(1)
    // Los cuatro valores por los que `sign-in/email` busca la credencial. Si
    // alguno sale distinto, el login no la encuentra y nadie entra.
    expect(accounts[0]).toMatchObject({
      userId,
      accountId: userId,
      providerId: "credential",
      issuer: "local:credential",
    })
  })
})

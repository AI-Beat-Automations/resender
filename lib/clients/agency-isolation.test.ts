import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

// Aislamiento del modo agencia contra un Postgres real (PGlite), con la cadena
// completa de migraciones. Lo que se prueba acá es SQL: que el predicado de
// alcance y las condiciones de la invitación hacen lo que dicen. Un mock de
// `getSql` no podría: devolvería lo que el test le pida.
//
// `getSql` se reemplaza por un adaptador del tag de Neon sobre PGlite: arma el
// texto con `$1…$n` y devuelve las filas, que es la forma que usan los
// módulos.

const db = new PGlite({ extensions: { pgcrypto } })

vi.mock("@/lib/db", () => {
  const sql = (strings: TemplateStringsArray, ...params: unknown[]) => {
    let text = strings[0] ?? ""
    params.forEach((_, index) => {
      text += `$${index + 1}${strings[index + 1] ?? ""}`
    })
    return db.query(text, params).then((result) => result.rows)
  }
  // PGlite encola las consultas en orden, que es lo que el batch necesita acá.
  sql.transaction = (queries: Promise<unknown>[]) => Promise.all(queries)
  return { getSql: () => sql }
})

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: {} }),
}))

import { deleteTenant } from "@/lib/account/account-repository"
import { lookupMediaForTenant } from "@/lib/messages/media-access"
import {
  listConversationReadModel,
  listThreadMessages,
} from "@/lib/messages/read-model"
import { ownerScope, type ConnectionScope } from "@/lib/pages/connection-scope"
import { listTenantPages } from "@/lib/pages/page-registry"

import {
  acceptAgencyClientInvitation,
  assignConnectionToClient,
  createAgencyClient,
  createAgencyClientInvitation,
  deleteAgencyClient,
  diagnoseInvitationEligibility,
  findInvitationPreview,
  listAgencyClients,
  revokeAgencyClientAccess,
} from "./client-repository"
import { generateInviteToken, hashInviteToken } from "./invite-token"

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations"
)

beforeAll(async () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
  }
}, 60_000)

afterAll(async () => {
  await db.close()
})

let seq = 0

async function insertUser(label: string, name = "") {
  seq += 1
  const result = await db.query<{ id: string }>(
    `insert into users (email, name) values ($1, $2) returning id`,
    [`${label}-${seq}@example.com`, name]
  )
  return result.rows[0]!.id
}

async function emailOf(userId: string) {
  const result = await db.query<{ email: string }>(
    `select email from users where id = $1`,
    [userId]
  )
  return result.rows[0]!.email
}

async function insertPage(tenantId: string, clientId: string | null = null) {
  seq += 1
  const result = await db.query<{ id: string }>(
    `insert into connected_pages (
       tenant_id, channel, meta_page_id, name, page_access_token_encrypted,
       agency_client_id
     )
     values ($1, 'instagram', $2, 'Cuenta', 'enc', $3) returning id`,
    [tenantId, `ig_${seq}`, clientId]
  )
  return result.rows[0]!.id
}

async function insertConversationWithMedia(tenantId: string, pageId: string) {
  seq += 1
  const conversation = await db.query<{ id: string }>(
    `insert into conversations (tenant_id, connected_page_id, contact_id)
     values ($1, $2, $3) returning id`,
    [tenantId, pageId, `igsid_${seq}`]
  )
  const conversationId = conversation.rows[0]!.id
  const message = await db.query<{ id: string }>(
    `insert into messages (
       tenant_id, conversation_id, connected_page_id, contact_id, direction,
       status, text, attachment_type, attachment_r2_key, attachment_status,
       attachment_meta
     )
     values ($1, $2, $3, $4, 'inbound', 'received', 'hola', 'image',
             'wa/key', 'available', '{"mimeType":"image/jpeg"}')
     returning id`,
    [tenantId, conversationId, pageId, `igsid_${seq}`]
  )
  return { conversationId, messageId: message.rows[0]!.id }
}

async function invite(
  tenantId: string,
  clientId: string,
  email: string | null = null
) {
  const token = generateInviteToken()
  const result = await createAgencyClientInvitation({
    tenantId,
    clientId,
    tokenHash: hashInviteToken(token),
    email,
  })
  return { token, hash: hashInviteToken(token), result }
}

const clientScope = (tenantId: string, clientId: string): ConnectionScope => ({
  tenantId,
  owner: false,
  clientId,
})

describe("invitaciones de cliente de agencia", () => {
  let juan: string
  let clientId: string

  beforeEach(async () => {
    juan = await insertUser("juan", "Agencia Juan")
    clientId = (await createAgencyClient(juan, "Panadería Pedro")).id
  })

  it("una persona sin datos propios acepta y queda en el cliente", async () => {
    const pedro = await insertUser("pedro")
    const { hash } = await invite(juan, clientId)

    expect(await findInvitationPreview(hash)).toEqual({
      clientName: "Panadería Pedro",
      agencyName: "Agencia Juan",
      boundToEmail: false,
    })
    await expect(acceptAgencyClientInvitation(pedro, hash)).resolves.toEqual({
      ok: true,
      clientId,
    })

    const [summary] = await listAgencyClients(juan)
    expect(summary?.member?.userId).toBe(pedro)
    expect(summary?.pendingInvitation).toBeNull()
  })

  it("el enlace sirve una sola vez", async () => {
    const pedro = await insertUser("pedro")
    const socio = await insertUser("socio")
    const { hash } = await invite(juan, clientId)

    await acceptAgencyClientInvitation(pedro, hash)

    await expect(acceptAgencyClientInvitation(socio, hash)).resolves.toEqual({
      ok: false,
      reason: "invalid_or_ineligible",
    })
    expect(await findInvitationPreview(hash)).toBeNull()
  })

  it("generar un enlace nuevo invalida el anterior", async () => {
    const pedro = await insertUser("pedro")
    const first = await invite(juan, clientId)
    const second = await invite(juan, clientId)

    expect(await findInvitationPreview(first.hash)).toBeNull()
    await expect(
      acceptAgencyClientInvitation(pedro, first.hash)
    ).resolves.toMatchObject({ ok: false })
    await expect(
      acceptAgencyClientInvitation(pedro, second.hash)
    ).resolves.toMatchObject({ ok: true })
  })

  it("no invita a un cliente que ya tiene persona", async () => {
    const pedro = await insertUser("pedro")
    const { hash } = await invite(juan, clientId)
    await acceptAgencyClientInvitation(pedro, hash)

    const again = await invite(juan, clientId)
    expect(again.result).toEqual({ ok: false, reason: "client_has_member" })
  })

  it("no invita a un cliente de otro tenant", async () => {
    const otra = await insertUser("otra")
    const { result } = await invite(otra, clientId)
    expect(result).toEqual({ ok: false, reason: "client_not_found" })
  })

  it("un enlace atado a un correo solo lo acepta ese correo", async () => {
    const pedro = await insertUser("pedro")
    const intruso = await insertUser("intruso")
    const { hash } = await invite(
      juan,
      clientId,
      (await emailOf(pedro)).toUpperCase()
    )

    expect(await diagnoseInvitationEligibility(intruso, hash)).toBe(
      "email_mismatch"
    )
    await expect(
      acceptAgencyClientInvitation(intruso, hash)
    ).resolves.toMatchObject({ ok: false })
    await expect(
      acceptAgencyClientInvitation(pedro, hash)
    ).resolves.toMatchObject({ ok: true })
  })

  it("una cuenta con datos propios no puede pasar a ser cliente", async () => {
    const conPaginas = await insertUser("con-paginas")
    await insertPage(conPaginas)
    const { hash } = await invite(juan, clientId)

    expect(await diagnoseInvitationEligibility(conPaginas, hash)).toBe(
      "has_own_data"
    )
    await expect(
      acceptAgencyClientInvitation(conPaginas, hash)
    ).resolves.toMatchObject({ ok: false })
    // No se consumió: sigue sirviendo para otra persona.
    expect(await findInvitationPreview(hash)).not.toBeNull()
  })

  it("el dueño no puede aceptar su propia invitación", async () => {
    const { hash } = await invite(juan, clientId)
    expect(await diagnoseInvitationEligibility(juan, hash)).toBe("own_account")
    await expect(
      acceptAgencyClientInvitation(juan, hash)
    ).resolves.toMatchObject({ ok: false })
  })

  it("revocar el acceso borra el usuario de la persona", async () => {
    const pedro = await insertUser("pedro")
    const { hash } = await invite(juan, clientId)
    await acceptAgencyClientInvitation(pedro, hash)

    expect(await revokeAgencyClientAccess(juan, clientId)).toBe(1)

    const left = await db.query(`select 1 from users where id = $1`, [pedro])
    expect(left.rows).toHaveLength(0)
    const [summary] = await listAgencyClients(juan)
    expect(summary?.member).toBeNull()
  })

  it("otro tenant no revoca ni borra clientes ajenos", async () => {
    const pedro = await insertUser("pedro")
    const otra = await insertUser("otra")
    const { hash } = await invite(juan, clientId)
    await acceptAgencyClientInvitation(pedro, hash)

    expect(await revokeAgencyClientAccess(otra, clientId)).toBe(0)
    expect(await deleteAgencyClient(otra, clientId)).toBe(false)
    expect(await listAgencyClients(juan)).toHaveLength(1)
  })
})

describe("alcance de un cliente de agencia sobre los datos", () => {
  it("Pedro solo ve lo suyo; Juan ve todo", async () => {
    const juan = await insertUser("juan")
    const pedroClient = (await createAgencyClient(juan, "Pedro")).id
    const mariaClient = (await createAgencyClient(juan, "María")).id

    const pedroPage = await insertPage(juan, pedroClient)
    const mariaPage = await insertPage(juan, mariaClient)
    const unassigned = await insertPage(juan, null)

    const pedroData = await insertConversationWithMedia(juan, pedroPage)
    const mariaData = await insertConversationWithMedia(juan, mariaPage)
    await insertConversationWithMedia(juan, unassigned)

    const pedro = clientScope(juan, pedroClient)

    expect((await listTenantPages(pedro)).map((page) => page.id)).toEqual([
      pedroPage,
    ])
    expect(await listTenantPages(ownerScope(juan))).toHaveLength(3)

    const pedroConversations = await listConversationReadModel({
      scope: pedro,
    })
    expect(pedroConversations.map((c) => c.id)).toEqual([
      pedroData.conversationId,
    ])
    expect(
      await listConversationReadModel({ scope: ownerScope(juan) })
    ).toHaveLength(3)

    // Forzar el id de una conversación ajena no trae nada.
    expect(
      await listThreadMessages({
        scope: pedro,
        conversationId: mariaData.conversationId,
      })
    ).toEqual([])

    // Ni el medio de un mensaje ajeno, adivinando el id.
    await expect(
      lookupMediaForTenant({ scope: pedro, messageId: mariaData.messageId })
    ).resolves.toEqual({ ok: false, reason: "not_found" })
    await expect(
      lookupMediaForTenant({ scope: pedro, messageId: pedroData.messageId })
    ).resolves.toMatchObject({ ok: true })
  })

  it("asignar mueve la conexión y su historial al cliente", async () => {
    const juan = await insertUser("juan")
    const pedroClient = (await createAgencyClient(juan, "Pedro")).id
    const page = await insertPage(juan, null)
    await insertConversationWithMedia(juan, page)
    const pedro = clientScope(juan, pedroClient)

    expect(await listConversationReadModel({ scope: pedro })).toHaveLength(0)

    await expect(
      assignConnectionToClient({
        tenantId: juan,
        connectionId: page,
        clientId: pedroClient,
      })
    ).resolves.toBe(true)
    expect(await listConversationReadModel({ scope: pedro })).toHaveLength(1)

    await assignConnectionToClient({
      tenantId: juan,
      connectionId: page,
      clientId: null,
    })
    expect(await listConversationReadModel({ scope: pedro })).toHaveLength(0)
  })

  it("no asigna a un cliente de otro tenant ni conexiones ajenas", async () => {
    const juan = await insertUser("juan")
    const otra = await insertUser("otra")
    const clientDeOtra = (await createAgencyClient(otra, "Ajeno")).id
    const page = await insertPage(juan, null)

    await expect(
      assignConnectionToClient({
        tenantId: juan,
        connectionId: page,
        clientId: clientDeOtra,
      })
    ).resolves.toBe(false)
    await expect(
      assignConnectionToClient({
        tenantId: otra,
        connectionId: page,
        clientId: clientDeOtra,
      })
    ).resolves.toBe(false)
  })

  it("borrar un cliente deja sus conexiones sin asignar y borra a su persona", async () => {
    const juan = await insertUser("juan")
    const clientId = (await createAgencyClient(juan, "Pedro")).id
    const page = await insertPage(juan, clientId)
    const pedro = await insertUser("pedro")
    const { hash } = await invite(juan, clientId)
    await acceptAgencyClientInvitation(pedro, hash)

    expect(await deleteAgencyClient(juan, clientId)).toBe(true)

    const [record] = await listTenantPages(ownerScope(juan))
    expect(record?.id).toBe(page)
    expect(record?.agencyClientId).toBeNull()
    const left = await db.query(`select 1 from users where id = $1`, [pedro])
    expect(left.rows).toHaveLength(0)
  })

  it("borrar la agencia se lleva a las personas de sus clientes", async () => {
    const juan = await insertUser("juan")
    const clientId = (await createAgencyClient(juan, "Pedro")).id
    const pedro = await insertUser("pedro")
    const { hash } = await invite(juan, clientId)
    await acceptAgencyClientInvitation(pedro, hash)

    await deleteTenant(juan)

    const left = await db.query(`select id from users where id in ($1, $2)`, [
      juan,
      pedro,
    ])
    expect(left.rows).toHaveLength(0)
  })
})

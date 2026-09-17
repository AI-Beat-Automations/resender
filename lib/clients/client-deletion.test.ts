import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  getClientAccount: vi.fn(),
  unsubscribeChannelWebhook: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ getSql: () => mocks.sql }))
vi.mock("@/lib/crypto/encryption", () => ({
  decryptSecret: (value: string) => `plain:${value}`,
}))
vi.mock("@/lib/pages/channel-webhook", () => ({
  unsubscribeChannelWebhook: mocks.unsubscribeChannelWebhook,
}))
vi.mock("./client-accounts", () => ({
  getClientAccount: mocks.getClientAccount,
}))

import { deleteClientWithConnections } from "./client-deletion"

const client = {
  id: "client-1",
  tenantId: "tenant-1",
  userId: null as string | null,
  name: "Panadería Sol",
  maxConnections: 2,
  status: "pending" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
}

function queryText(call: unknown[]): string {
  return (call[0] as string[]).join("")
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.getClientAccount.mockResolvedValue(client)
  mocks.unsubscribeChannelWebhook.mockResolvedValue(true)
  // Primera consulta: las conexiones del cliente. Las siguientes: los deletes.
  mocks.sql.mockResolvedValueOnce([
    {
      id: "conn-1",
      channel: "messenger",
      meta_page_id: "page-1",
      waba_id: null,
      status: "active",
      page_access_token_encrypted: "enc-1",
    },
    {
      id: "conn-2",
      channel: "whatsapp",
      meta_page_id: "phone-1",
      waba_id: "waba-1",
      status: "active",
      page_access_token_encrypted: "enc-2",
    },
    {
      id: "conn-3",
      channel: "instagram",
      meta_page_id: "ig-1",
      waba_id: null,
      status: "disconnected",
      page_access_token_encrypted: "enc-3",
    },
  ])
  mocks.sql.mockResolvedValue([])
})

describe("deleteClientWithConnections", () => {
  it("da de baja en Meta cada conexión activa del cliente antes de borrar", async () => {
    await expect(
      deleteClientWithConnections("tenant-1", "client-1")
    ).resolves.toEqual(client)

    // Solo las activas: la desconectada ya no recibe eventos.
    expect(mocks.unsubscribeChannelWebhook).toHaveBeenCalledTimes(2)
    expect(mocks.unsubscribeChannelWebhook).toHaveBeenCalledWith({
      channel: "messenger",
      metaPageId: "page-1",
      accessToken: "plain:enc-1",
      wabaId: null,
      excludeConnectionIds: ["conn-1", "conn-2", "conn-3"],
    })
    expect(mocks.unsubscribeChannelWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "whatsapp",
        metaPageId: "phone-1",
        wabaId: "waba-1",
      })
    )
  })

  it("borra el espacio del cliente (las conexiones caen por cascade)", async () => {
    await deleteClientWithConnections("tenant-1", "client-1")

    const deletes = mocks.sql.mock.calls
      .map(queryText)
      .filter((text) => text.includes("delete from"))
    expect(deletes).toHaveLength(1)
    expect(deletes[0]).toContain("delete from client_accounts")
    expect(deletes[0]).not.toContain("users")
  })

  it("si el cliente ya aceptó, borra también su user", async () => {
    mocks.getClientAccount.mockResolvedValue({ ...client, userId: "user-9" })

    await deleteClientWithConnections("tenant-1", "client-1")

    const userDelete = mocks.sql.mock.calls.find((call) =>
      queryText(call).includes("delete from users")
    )
    expect(userDelete).toBeDefined()
    expect(userDelete).toContain("user-9")
  })

  it("un fallo en Meta no bloquea el borrado", async () => {
    mocks.unsubscribeChannelWebhook.mockRejectedValue(new Error("Meta caída"))

    await expect(
      deleteClientWithConnections("tenant-1", "client-1")
    ).resolves.toEqual(client)
    expect(
      mocks.sql.mock.calls.some((call) =>
        queryText(call).includes("delete from client_accounts")
      )
    ).toBe(true)
  })

  it("devuelve null y no toca nada si el cliente no es del tenant", async () => {
    mocks.getClientAccount.mockResolvedValue(null)
    await expect(
      deleteClientWithConnections("tenant-1", "client-x")
    ).resolves.toBeNull()
    expect(mocks.unsubscribeChannelWebhook).not.toHaveBeenCalled()
  })
})

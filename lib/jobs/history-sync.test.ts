import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  requestWhatsappHistorySync: vi.fn(),
  updateWhatsappHistorySyncStatus: vi.fn(),
  decryptSecret: vi.fn(),
  log: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ getSql: () => mocks.sql }))
vi.mock("@/lib/meta/whatsapp-client", () => ({
  requestWhatsappHistorySync: mocks.requestWhatsappHistorySync,
}))
vi.mock("@/lib/pages/page-registry", () => ({
  updateWhatsappHistorySyncStatus: mocks.updateWhatsappHistorySyncStatus,
}))
vi.mock("@/lib/crypto/encryption", () => ({
  decryptSecret: mocks.decryptSecret,
}))
vi.mock("@/lib/observability/logger", () => ({ log: mocks.log }))

import { markHistorySyncFailed, requestHistorySync } from "./history-sync"

function connection(overrides: Record<string, unknown> = {}) {
  mocks.sql.mockResolvedValue([
    {
      tenant_id: "t1",
      meta_page_id: "1555550001",
      page_access_token_encrypted: "enc",
      history_sync_status: "not_requested",
      status: "active",
      ...overrides,
    },
  ])
}

describe("pedido del sync de historial", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.decryptSecret.mockReturnValue("token-claro")
    mocks.requestWhatsappHistorySync.mockResolvedValue(undefined)
    mocks.updateWhatsappHistorySyncStatus.mockResolvedValue(true)
  })

  // El caso que justifica que esto exista: sin la llamada no llega ningún
  // `history` y la conexión se pierde sola a las 24 h, sin que nada falle.
  it("le pide el sync a Meta y deja el estado en requested", async () => {
    connection()

    await expect(
      requestHistorySync({ connectionId: "conn-1" })
    ).resolves.toEqual({ ok: true })

    expect(mocks.requestWhatsappHistorySync).toHaveBeenCalledWith(
      "token-claro",
      "1555550001"
    )
    expect(mocks.updateWhatsappHistorySyncStatus).toHaveBeenCalledWith({
      connectionId: "conn-1",
      status: "requested",
    })
  })

  // El token viaja cifrado en la base; mandarle a Meta el texto cifrado sería un
  // 401 que se registraría como un fallo cualquiera.
  it("descifra el token antes de llamar", async () => {
    connection()
    await requestHistorySync({ connectionId: "conn-1" })
    expect(mocks.decryptSecret).toHaveBeenCalledWith("enc")
  })

  // Un segundo pedido no es gratis: vuelve a arrancar el reloj del lado de Meta
  // y puede duplicar chunks. El reintento de la cola tiene que poder repetirse
  // sin repetir la llamada.
  it.each(["requested", "in_progress", "complete", "failed"])(
    "no vuelve a pedirlo si el estado ya es %s",
    async (status) => {
      connection({ history_sync_status: status })

      await expect(
        requestHistorySync({ connectionId: "conn-1" })
      ).resolves.toEqual({ ok: true })

      expect(mocks.requestWhatsappHistorySync).not.toHaveBeenCalled()
    }
  )

  // Vencida no se revive pidiendo de nuevo: hay que rehacer el Embedded Signup,
  // y volver a pedirlo solo ensuciaría el estado que ve el tenant.
  it("no vuelve a pedirlo sobre una conexión vencida", async () => {
    connection({ history_sync_status: "expired" })
    await requestHistorySync({ connectionId: "conn-1" })
    expect(mocks.requestWhatsappHistorySync).not.toHaveBeenCalled()
    expect(mocks.updateWhatsappHistorySyncStatus).not.toHaveBeenCalled()
  })

  it("no pide nada si la conexión ya no está", async () => {
    mocks.sql.mockResolvedValue([])

    await expect(
      requestHistorySync({ connectionId: "conn-1" })
    ).resolves.toEqual({
      ok: false,
      permanent: true,
      reason: "connection_not_found",
    })
    expect(mocks.requestWhatsappHistorySync).not.toHaveBeenCalled()
  })

  it("no pide nada sobre una conexión desconectada", async () => {
    connection({ status: "disconnected" })

    await expect(
      requestHistorySync({ connectionId: "conn-1" })
    ).resolves.toEqual({
      ok: false,
      permanent: true,
      reason: "connection_not_active",
    })
    expect(mocks.requestWhatsappHistorySync).not.toHaveBeenCalled()
  })

  // Si Meta rechaza, el error sube para que la cola reintente. Tragarlo acá
  // dejaría el estado en `not_requested` sin que nadie lo vuelva a intentar.
  it("deja subir el fallo de Meta para que la cola reintente", async () => {
    connection()
    mocks.requestWhatsappHistorySync.mockRejectedValue(new Error("graph 500"))

    await expect(
      requestHistorySync({ connectionId: "conn-1" })
    ).rejects.toThrow("graph 500")
    expect(mocks.updateWhatsappHistorySyncStatus).not.toHaveBeenCalled()
  })
})

describe("sync agotado", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.updateWhatsappHistorySyncStatus.mockResolvedValue(true)
  })

  // Que quede visible es el punto: sin esto la conexión se queda callada hasta
  // que vencen las 24 h y nadie se entera de por qué.
  it("deja el estado en failed", async () => {
    await markHistorySyncFailed("conn-1")

    expect(mocks.updateWhatsappHistorySyncStatus).toHaveBeenCalledWith({
      connectionId: "conn-1",
      status: "failed",
    })
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failed",
        reason: "history_sync_failed",
      })
    )
  })
})

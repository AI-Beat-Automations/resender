import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ sql: vi.fn() }))

vi.mock("@/lib/db", () => ({ getSql: () => mocks.sql }))
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { WHATSAPP_MEDIA: {} } }),
}))

import { lookupMediaForTenant } from "./media-access"

const NOW = new Date("2026-08-24T12:00:00Z")

function rows(row: Record<string, unknown> | null) {
  mocks.sql.mockResolvedValue(row ? [row] : [])
}

describe("autorización de un medio entrante", () => {
  beforeEach(() => mocks.sql.mockReset())

  it("entrega la key cuando el medio está disponible", async () => {
    rows({
      attachment_r2_key: "wa/t1/m1/abc",
      attachment_status: "available",
      attachment_meta: { mimeType: "image/jpeg", sizeBytes: 1234 },
      created_at: NOW,
    })

    await expect(
      lookupMediaForTenant({ tenantId: "t1", messageId: "m1", now: NOW })
    ).resolves.toEqual({
      ok: true,
      key: "wa/t1/m1/abc",
      mimeType: "image/jpeg",
      sizeBytes: 1234,
    })
  })

  // El ownership se resuelve en el `where` de la consulta, así que un mensaje
  // de otro tenant simplemente no vuelve. La ruta contesta 404 y no 403: un 403
  // confirmaría que ese id existe.
  it("no encuentra el mensaje de otro tenant", async () => {
    rows(null)
    await expect(
      lookupMediaForTenant({ tenantId: "otro", messageId: "m1", now: NOW })
    ).resolves.toEqual({ ok: false, reason: "not_found" })
  })

  // Un mensaje sin adjunto no es un adjunto no disponible: no hay estado que
  // reportar.
  it("trata un mensaje sin adjunto como inexistente", async () => {
    rows({
      attachment_r2_key: null,
      attachment_status: null,
      attachment_meta: null,
      created_at: NOW,
    })
    await expect(
      lookupMediaForTenant({ tenantId: "t1", messageId: "m1", now: NOW })
    ).resolves.toEqual({ ok: false, reason: "not_found" })
  })

  it.each([
    ["pending", "pending"],
    ["failed", "failed"],
    ["unavailable", "unavailable"],
  ])(
    "reporta el estado %s en vez de servir bytes",
    async (stored, expected) => {
      rows({
        attachment_r2_key: null,
        attachment_status: stored,
        attachment_meta: null,
        created_at: NOW,
      })
      await expect(
        lookupMediaForTenant({ tenantId: "t1", messageId: "m1", now: NOW })
      ).resolves.toEqual({
        ok: false,
        reason: "not_available",
        status: expected,
      })
    }
  )

  // El caso que justifica derivar el estado de la edad: la fila sigue diciendo
  // `available` porque nada la actualiza, pero la lifecycle rule de R2 ya borró
  // el objeto a los 180 días.
  it("deriva `deleted` de la edad aunque la fila diga available", async () => {
    const old = new Date("2026-01-01T12:00:00Z")
    rows({
      attachment_r2_key: "wa/t1/m1/abc",
      attachment_status: "available",
      attachment_meta: { mimeType: "image/jpeg" },
      created_at: old,
    })

    await expect(
      lookupMediaForTenant({ tenantId: "t1", messageId: "m1", now: NOW })
    ).resolves.toEqual({
      ok: false,
      reason: "not_available",
      status: "deleted",
    })
  })

  it("cae a un content-type genérico si el meta no lo trae", async () => {
    rows({
      attachment_r2_key: "wa/t1/m1/abc",
      attachment_status: "available",
      attachment_meta: {},
      created_at: NOW,
    })

    await expect(
      lookupMediaForTenant({ tenantId: "t1", messageId: "m1", now: NOW })
    ).resolves.toMatchObject({
      ok: true,
      mimeType: "application/octet-stream",
      sizeBytes: null,
    })
  })
})

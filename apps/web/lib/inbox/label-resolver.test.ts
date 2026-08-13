import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  fetchInstagramContactProfile: vi.fn(),
  fetchInstagramMedia: vi.fn(),
  getActivePageWithTokenByConnectionId: vi.fn(),
  listCachedMedia: vi.fn(),
  saveContactProfile: vi.fn(),
  saveMedia: vi.fn(),
}))

vi.mock("@/lib/instagram", () => ({
  fetchInstagramContactProfile: mocks.fetchInstagramContactProfile,
  fetchInstagramMedia: mocks.fetchInstagramMedia,
}))

vi.mock("@/lib/pages/page-registry", () => ({
  getActivePageWithTokenByConnectionId:
    mocks.getActivePageWithTokenByConnectionId,
}))

vi.mock("./label-cache", () => ({
  listCachedMedia: mocks.listCachedMedia,
  saveContactProfile: mocks.saveContactProfile,
  saveMedia: mocks.saveMedia,
}))

vi.mock("@/lib/posthog", () => ({ posthog: null }))

import { resolveContactProfiles } from "./label-resolver"
import type { ResolvableContact } from "./label-resolver"

const contact = (overrides: Partial<ResolvableContact>): ResolvableContact => ({
  conversationId: "conv-1",
  connectedPageId: "page-1",
  channel: "instagram",
  contactId: "igsid-1",
  contactUsername: null,
  contactSyncedAt: null,
  ...overrides,
})

describe("resolución del perfil del contacto por canal", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.getActivePageWithTokenByConnectionId.mockResolvedValue({
      pageAccessToken: "ig-token",
    })
    mocks.fetchInstagramContactProfile.mockResolvedValue({
      username: "lori_surianno",
      name: "Lori",
    })
    mocks.saveContactProfile.mockResolvedValue(undefined)
  })

  it("pide a Graph el @handle que el webhook de Instagram no trae", async () => {
    const resolved = await resolveContactProfiles("tenant-1", [
      contact({ channel: "instagram" }),
    ])

    expect(mocks.fetchInstagramContactProfile).toHaveBeenCalledWith(
      "ig-token",
      "igsid-1"
    )
    expect(resolved.get("conv-1")).toEqual({
      username: "lori_surianno",
      name: "Lori",
    })
  })

  // Los perfiles de Messenger piden `pages_user_profile`, que no está en el
  // `config_id` del login: pedirlos sería una llamada que siempre falla.
  it("no pide nada en Messenger", async () => {
    const resolved = await resolveContactProfiles("tenant-1", [
      contact({ channel: "messenger", contactId: "psid-1" }),
    ])

    expect(mocks.fetchInstagramContactProfile).not.toHaveBeenCalled()
    expect(mocks.getActivePageWithTokenByConnectionId).not.toHaveBeenCalled()
    expect(resolved.size).toBe(0)
  })

  // WhatsApp cae del mismo lado, pero por otro motivo y ahora **dicho**: el
  // nombre llega en `contacts[].profile.name` del propio webhook y la ingesta ya
  // lo guardó en `conversations.contact_name`. No hay @handle que resolver ni
  // llamada que valga la pena pagar en el render.
  it("no pide nada en WhatsApp: el nombre ya vino en el webhook", async () => {
    const resolved = await resolveContactProfiles("tenant-1", [
      contact({ channel: "whatsapp", contactId: "5215512345678" }),
    ])

    expect(mocks.fetchInstagramContactProfile).not.toHaveBeenCalled()
    expect(mocks.getActivePageWithTokenByConnectionId).not.toHaveBeenCalled()
    expect(resolved.size).toBe(0)
  })

  // Un lote mezclado es el caso real de un tenant con los tres canales: el
  // filtro tiene que dejar pasar solo el de Instagram y no arrastrar al resto.
  it("resuelve solo Instagram en un lote de los tres canales", async () => {
    const resolved = await resolveContactProfiles("tenant-1", [
      contact({ conversationId: "conv-fb", channel: "messenger" }),
      contact({ conversationId: "conv-ig", channel: "instagram" }),
      contact({ conversationId: "conv-wa", channel: "whatsapp" }),
    ])

    expect(mocks.fetchInstagramContactProfile).toHaveBeenCalledTimes(1)
    expect([...resolved.keys()]).toEqual(["conv-ig"])
  })

  it("no vuelve a pedir el perfil que ya tiene @handle", async () => {
    await resolveContactProfiles("tenant-1", [
      contact({ contactUsername: "cafe.rioja" }),
    ])

    expect(mocks.fetchInstagramContactProfile).not.toHaveBeenCalled()
  })

  // El fallo también se persiste (los dos campos en null pero sellando
  // `contact_synced_at`): es lo que corta el reintento en cada render.
  it("sella el intento aunque Graph no resuelva el contacto", async () => {
    mocks.fetchInstagramContactProfile.mockResolvedValue(null)

    const resolved = await resolveContactProfiles("tenant-1", [contact({})])

    expect(mocks.saveContactProfile).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      username: null,
      name: null,
    })
    expect(resolved.size).toBe(0)
  })
})

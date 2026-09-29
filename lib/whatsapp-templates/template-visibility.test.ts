import { describe, expect, it } from "vitest"

import type { WhatsappTemplateRecord } from "./template-store"
import {
  resolveTemplateNumber,
  templateNumbersForActor,
  templateStatusTone,
  toTemplateRows,
} from "./template-visibility"

const TENANT = "tenant-1"
const CLIENT = "client-1"
const OTHER_CLIENT = "client-2"

const parent = { tenantId: TENANT, clientAccountId: null }
const client = { tenantId: TENANT, clientAccountId: CLIENT }

const page = (overrides: Record<string, unknown> = {}) => ({
  id: "conn-parent",
  tenantId: TENANT,
  clientAccountId: null as string | null,
  channel: "whatsapp" as "whatsapp" | "messenger" | "instagram",
  status: "active" as "active" | "disconnected",
  wabaId: "waba-parent" as string | null,
  whatsappPhoneE164: "+5215500000001" as string | null,
  name: "Número del padre",
  ...overrides,
})

const pages = [
  page(),
  page({
    id: "conn-client",
    clientAccountId: CLIENT,
    wabaId: "waba-client",
    whatsappPhoneE164: "+5215500000002",
  }),
  page({
    id: "conn-other-client",
    clientAccountId: OTHER_CLIENT,
    wabaId: "waba-other",
    whatsappPhoneE164: "+5215500000003",
  }),
  page({ id: "conn-messenger", channel: "messenger", wabaId: null }),
  page({ id: "conn-off", status: "disconnected", wabaId: "waba-off" }),
]

const template = (
  overrides: Partial<WhatsappTemplateRecord> = {}
): WhatsappTemplateRecord => ({
  id: "tpl-1",
  wabaId: "waba-parent",
  name: "hello_world",
  language: "en_US",
  metaTemplateId: "123",
  category: "utility",
  status: "APPROVED",
  body: "Hello World",
  createdByTenantId: null,
  createdByClientAccountId: null,
  syncedAt: new Date(0),
  createdAt: new Date(0),
  ...overrides,
})

describe("templateNumbersForActor", () => {
  it("el padre ve los números de WhatsApp activos de todo el tenant, también los de sus clientes", () => {
    expect(
      templateNumbersForActor(pages, parent).map((n) => n.wabaId)
    ).toEqual(["waba-parent", "waba-client", "waba-other"])
  })

  it("el cliente ve solo los suyos, aunque la lista traiga los de otros", () => {
    expect(templateNumbersForActor(pages, client)).toEqual([
      { id: "conn-client", wabaId: "waba-client", label: "+5215500000002" },
    ])
  })

  it("deja fuera Messenger, Instagram, los desconectados y los de otro tenant", () => {
    const numbers = templateNumbersForActor(
      [...pages, page({ id: "conn-foreign", tenantId: "tenant-2" })],
      parent
    )
    expect(numbers.map((n) => n.id)).not.toContain("conn-messenger")
    expect(numbers.map((n) => n.id)).not.toContain("conn-off")
    expect(numbers.map((n) => n.id)).not.toContain("conn-foreign")
  })

  it("sin número E.164 nombra el número por la conexión", () => {
    expect(
      templateNumbersForActor([page({ whatsappPhoneE164: null })], parent)[0]
        ?.label
    ).toBe("Número del padre")
  })
})

describe("resolveTemplateNumber", () => {
  const numbers = templateNumbersForActor(pages, parent)

  it("elige el número de la URL si es del actor", () => {
    expect(resolveTemplateNumber(numbers, "conn-client")?.id).toBe(
      "conn-client"
    )
  })

  it("sin parámetro, o con uno ajeno, cae en el primero", () => {
    expect(resolveTemplateNumber(numbers, undefined)?.id).toBe("conn-parent")
    expect(
      resolveTemplateNumber(
        templateNumbersForActor(pages, client),
        "conn-parent"
      )?.id
    ).toBe("conn-client")
  })

  it("sin números no hay catálogo", () => {
    expect(resolveTemplateNumber([], "conn-parent")).toBeNull()
  })
})

describe("toTemplateRows", () => {
  const ownedByParent = template({
    id: "tpl-parent",
    createdByTenantId: TENANT,
  })
  const ownedByClient = template({
    id: "tpl-client",
    createdByTenantId: TENANT,
    createdByClientAccountId: CLIENT,
  })
  const imported = template({ id: "tpl-imported" })
  const otherTenant = template({
    id: "tpl-foreign",
    createdByTenantId: "tenant-2",
  })
  const all = [ownedByParent, ownedByClient, imported, otherTenant]

  const owned = (actor: typeof parent | typeof client) =>
    toTemplateRows(all, actor)
      .filter((row) => row.owned)
      .map((row) => row.id)

  it("para el padre es propia solo la que creó él, no la de su cliente", () => {
    expect(owned(parent)).toEqual(["tpl-parent"])
  })

  it("para el cliente es propia solo la suya, no la del padre", () => {
    expect(owned(client)).toEqual(["tpl-client"])
  })

  it("hello_world, importada por el sync, es de solo lectura para todos", () => {
    const rows = [
      ...toTemplateRows([imported], parent),
      ...toTemplateRows([imported], client),
    ]
    expect(rows.every((row) => !row.owned)).toBe(true)
  })
})

describe("templateStatusTone", () => {
  it("pinta cada estado, incluido el desconocido", () => {
    expect(templateStatusTone("APPROVED")).toBe("success")
    expect(templateStatusTone("PENDING")).toBe("info")
    expect(templateStatusTone("PAUSED")).toBe("warning")
    expect(templateStatusTone("REJECTED")).toBe("destructiveSoft")
    expect(templateStatusTone("unknown")).toBe("outline")
  })
})

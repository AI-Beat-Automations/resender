import { beforeEach, describe, expect, it, vi } from "vitest"

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }))

vi.mock("@/lib/db", () => ({ getSql: () => sqlMock }))

import {
  countActiveAccounts,
  getAccountOwnership,
  getPageOwnership,
  hasActiveAccountOnChannel,
} from "./page-registry"

// Reconstruye el SQL que salió del tagged template, con los parámetros ya
// inlineados: es lo único que permite afirmar algo sobre un predicado que solo
// existe dentro del template.
const lastStatement = () => {
  const call = sqlMock.mock.calls.at(-1)
  if (!call) throw new Error("no query was issued")
  const [strings, ...params] = call as [TemplateStringsArray, ...unknown[]]
  return strings
    .map((part, index) =>
      index < params.length ? `${part}${JSON.stringify(params[index])}` : part
    )
    .join("")
}

beforeEach(() => {
  sqlMock.mockReset()
  sqlMock.mockResolvedValue([])
})

// **El invariante que este archivo existe para defender.** `countActiveAccounts` y
// `getPageOwnership` difieren en un `channel = 'messenger'` y eso se lee como
// una inconsistencia, pero son dos preguntas distintas. Hasta ahora lo sostenían
// solo el SQL y unos comentarios, y un comentario no falla cuando alguien
// «arregla» la diferencia.
describe("el filtro de canal, donde va y donde no", () => {
  // ADR 0010: el cupo se mide en cuentas conectadas, de cualquier canal. Si
  // volviera el filtro, una cuenta de Instagram dejaría de ocupar slot y el
  // Starter permitiría 2 Páginas **más** N cuentas de IG.
  it("no acota por canal el conteo que alimenta el cupo del plan", async () => {
    await countActiveAccounts("tenant-1")

    const statement = lastStatement()
    expect(statement).toContain("from connected_pages")
    expect(statement).toContain("status = 'active'")
    expect(statement).not.toContain("channel =")
  })

  // Recibe **page ids de Facebook**, y desde la migración 0013 una cuenta de
  // Instagram puede tener el mismo id legítimamente. Sin el filtro, esa homónima
  // haría que una Página se muestre como «ya pertenece a otra cuenta».
  it("sí acota a Messenger la búsqueda de ownership por page id de Facebook", async () => {
    await getPageOwnership(["104233889761204"])

    expect(lastStatement()).toContain("channel = 'messenger'")
  })
})

describe("getAccountOwnership", () => {
  it("distingue sin dueño, de este tenant y de otro", async () => {
    sqlMock.mockResolvedValueOnce([])
    await expect(
      getAccountOwnership({
        tenantId: "tenant-1",
        channel: "instagram",
        metaPageId: "ig-1",
      })
    ).resolves.toEqual({ owner: "none" })

    sqlMock.mockResolvedValueOnce([{ tenant_id: "tenant-1", status: "active" }])
    await expect(
      getAccountOwnership({
        tenantId: "tenant-1",
        channel: "instagram",
        metaPageId: "ig-1",
      })
    ).resolves.toEqual({ owner: "self", status: "active" })

    // El caso que el gate de cupo tiene que dejar pasar: no es falta de cupo,
    // es propiedad, y el mensaje correcto lo da `PageOwnershipError`.
    sqlMock.mockResolvedValueOnce([{ tenant_id: "tenant-2", status: "active" }])
    await expect(
      getAccountOwnership({
        tenantId: "tenant-1",
        channel: "instagram",
        metaPageId: "ig-1",
      })
    ).resolves.toEqual({ owner: "other" })
  })

  // Acá el canal **sí** viaja, y es obligatorio: el unique de la 0013 es
  // `(channel, meta_page_id)`, así que buscar sin canal puede traer la fila del
  // otro.
  it("busca siempre dentro de un canal", async () => {
    await getAccountOwnership({
      tenantId: "tenant-1",
      channel: "instagram",
      metaPageId: "ig-1",
    })

    expect(lastStatement()).toContain('channel = "instagram"')
  })
})

describe("hasActiveAccountOnChannel", () => {
  it("es falso sin filas y verdadero con una", async () => {
    sqlMock.mockResolvedValueOnce([])
    await expect(hasActiveAccountOnChannel("tenant-1", "instagram")).resolves.toBe(
      false
    )

    sqlMock.mockResolvedValueOnce([{ exists: 1 }])
    await expect(hasActiveAccountOnChannel("tenant-1", "instagram")).resolves.toBe(
      true
    )
  })
})

import { describe, expect, it } from "vitest"

import {
  hasInstagramAccess,
  hasWhatsappAccess,
  toChannelAccess,
  type ChannelAccessRow,
} from "./channel-access"

// Las filas de prueba se arman con este helper para que agregar una cuarta
// bandera no obligue a tocar veinte literales: el default de cada canal es
// cerrado, igual que el de la columna.
function row(overrides: Partial<ChannelAccessRow> = {}): ChannelAccessRow {
  return { instagram_enabled: false, whatsapp_enabled: false, ...overrides }
}

describe("instagram channel access", () => {
  it("grants access only when the flag is explicitly true", () => {
    expect(hasInstagramAccess(row({ instagram_enabled: true }))).toBe(true)
  })

  it("denies access to an account without the permission", () => {
    expect(hasInstagramAccess(row({ instagram_enabled: false }))).toBe(false)
  })

  it("fails closed when the user row is missing", () => {
    expect(hasInstagramAccess(null)).toBe(false)
    expect(hasInstagramAccess(undefined)).toBe(false)
  })

  // Una bandera que no es booleana solo puede venir de una fila que no es la
  // que creemos —driver que devuelve otra forma, columna renombrada—, y el
  // permiso tiene que cerrarse antes que asumir que el canal está habilitado.
  it("fails closed when the flag is unreadable", () => {
    expect(
      hasInstagramAccess({
        instagram_enabled: null,
      } as unknown as ChannelAccessRow)
    ).toBe(false)
    expect(hasInstagramAccess({} as unknown as ChannelAccessRow)).toBe(false)
  })
})

describe("whatsapp channel access", () => {
  it("grants access only when the flag is explicitly true", () => {
    expect(hasWhatsappAccess(row({ whatsapp_enabled: true }))).toBe(true)
  })

  it("denies access to an account without the permission", () => {
    expect(hasWhatsappAccess(row({ whatsapp_enabled: false }))).toBe(false)
  })

  it("fails closed when the user row is missing", () => {
    expect(hasWhatsappAccess(null)).toBe(false)
    expect(hasWhatsappAccess(undefined)).toBe(false)
  })

  it("fails closed when the flag is unreadable", () => {
    expect(
      hasWhatsappAccess({
        whatsapp_enabled: null,
      } as unknown as ChannelAccessRow)
    ).toBe(false)
    expect(hasWhatsappAccess({} as unknown as ChannelAccessRow)).toBe(false)
  })
})

describe("channel access map", () => {
  // El caso que obliga a que las banderas sean dos columnas y no una: los dos
  // permisos son de Meta pero se conceden por separado, así que tener uno no
  // dice nada del otro.
  it("keeps the two permissions independent", () => {
    expect(toChannelAccess(row({ instagram_enabled: true }))).toEqual({
      messenger: true,
      instagram: true,
      whatsapp: false,
    })
    expect(toChannelAccess(row({ whatsapp_enabled: true }))).toEqual({
      messenger: true,
      instagram: false,
      whatsapp: true,
    })
  })

  // Messenger nunca tuvo bandera: es el canal con el que el producto nació y su
  // Advanced Access está concedido desde el principio. Que siga en `true` con
  // la fila ausente es lo que evita que un bug de permisos apague el canal que
  // sí funciona.
  it("never closes Messenger, not even without a row", () => {
    expect(toChannelAccess(null).messenger).toBe(true)
    expect(toChannelAccess(undefined).messenger).toBe(true)
  })

  it("fails closed on both flagged channels when the row is missing", () => {
    expect(toChannelAccess(null)).toEqual({
      messenger: true,
      instagram: false,
      whatsapp: false,
    })
  })
})

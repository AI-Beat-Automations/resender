import { describe, expect, it } from "vitest"

import type { TemplateAdminView } from "./template-admin"
import {
  describeWhatsappTemplateFailure,
  resolveWhatsappNumberSelection,
  toWhatsappNumberOptions,
  toWhatsappTemplateRowView,
  whatsappTemplatesHref,
  type WhatsappNumberSource,
} from "./template-console"

function connection(
  overrides: Partial<WhatsappNumberSource> = {}
): WhatsappNumberSource {
  return {
    channel: "whatsapp",
    status: "active",
    metaPageId: "15550001111",
    name: "Tienda",
    whatsappPhoneE164: "+34600111222",
    ...overrides,
  }
}

function template(
  overrides: Partial<TemplateAdminView> = {}
): TemplateAdminView {
  return {
    id: "3f7c0d18-0f0e-4a1e-9d0e-9f2f0f0b0001",
    name: "order_update",
    language: "es",
    status: "APPROVED",
    category: "utility",
    metaTemplateId: "1234567890",
    own: true,
    createdAt: "2026-08-01T10:00:00.000Z",
    syncedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  }
}

describe("números que ofrece la pantalla de plantillas", () => {
  it("deja fuera los otros canales", () => {
    // `listTenantPages` trae las conexiones de los tres canales y ni Messenger
    // ni Instagram tienen catálogo de plantillas.
    const options = toWhatsappNumberOptions([
      connection(),
      connection({ channel: "messenger", metaPageId: "1122" }),
      connection({ channel: "instagram", metaPageId: "3344" }),
    ])

    expect(options).toEqual([{ pageId: "15550001111", label: "+34600111222" }])
  })

  it("deja fuera el número desconectado", () => {
    // Sin token no hay con qué hablarle a Graph: ofrecerlo sería una pantalla
    // que solo sabe fallar.
    expect(
      toWhatsappNumberOptions([connection({ status: "disconnected" })])
    ).toEqual([])
  })

  it("cae al nombre de la conexión cuando no hay teléfono", () => {
    expect(
      toWhatsappNumberOptions([connection({ whatsappPhoneE164: null })])
    ).toEqual([{ pageId: "15550001111", label: "Tienda" }])
  })
})

describe("qué número se está mirando", () => {
  const numbers = [
    { pageId: "one", label: "+34600111222" },
    { pageId: "two", label: "+34600333444" },
  ]

  it("respeta el número pedido por la URL", () => {
    expect(resolveWhatsappNumberSelection(numbers, "two")).toEqual(numbers[1])
  })

  it("cae al primero cuando el pedido no es del tenant", () => {
    // El parámetro es entrada del usuario, no un contrato: un id ajeno o el de
    // un número que desconectó no puede dejar la pantalla en blanco.
    expect(resolveWhatsappNumberSelection(numbers, "otro")).toEqual(numbers[0])
  })

  it("cae al primero con el `?number=a&number=b` que produce un array", () => {
    expect(resolveWhatsappNumberSelection(numbers, ["x", "two"])).toEqual(
      numbers[0]
    )
  })

  it("devuelve null cuando el tenant no tiene ningún número", () => {
    // Es el estado vacío con camino a /connections, no un error.
    expect(resolveWhatsappNumberSelection([], "one")).toBeNull()
  })

  it("escribe el número seleccionado en el enlace", () => {
    expect(whatsappTemplatesHref("15550001111")).toBe(
      "/templates?number=15550001111"
    )
    expect(whatsappTemplatesHref(null)).toBe("/templates")
  })
})

describe("qué se puede hacer con una fila del catálogo", () => {
  it("deja editar y borrar la propia con hsm id", () => {
    const row = toWhatsappTemplateRowView(template())

    expect(row.editable).toBe(true)
    expect(row.lock).toBeNull()
  })

  it("bloquea la ajena y dice que es ajena", () => {
    // El catálogo es de la WABA y puede tener números de otro cliente: nadie
    // edita ni borra lo que no creó (ADR 0014).
    const row = toWhatsappTemplateRowView(template({ own: false }))

    expect(row.editable).toBe(false)
    expect(row.lock).toBe("foreign")
  })

  it("bloquea la propia sin hsm id, para no borrar por nombre", () => {
    // Sin hsm id el borrado tendría que ser por nombre, que se lleva todas las
    // versiones de idioma y quema el nombre 30 días.
    const row = toWhatsappTemplateRowView(template({ metaTemplateId: null }))

    expect(row.editable).toBe(false)
    expect(row.lock).toBe("missing_meta_id")
  })

  it("explica por ajena la que además no tiene hsm id", () => {
    // Es la razón que el usuario puede entender y la que no cambia si mañana
    // llega el sync.
    const row = toWhatsappTemplateRowView(
      template({ own: false, metaTemplateId: null })
    )

    expect(row.lock).toBe("foreign")
  })

  it("avisa de que editar una aprobada la devuelve a revisión", () => {
    expect(toWhatsappTemplateRowView(template()).returnsToReviewOnEdit).toBe(
      true
    )
    expect(
      toWhatsappTemplateRowView(template({ status: "PENDING" }))
        .returnsToReviewOnEdit
    ).toBe(false)
  })

  it("marca la rechazada para que la fila pueda explicar por qué", () => {
    expect(
      toWhatsappTemplateRowView(template({ status: "REJECTED" })).rejected
    ).toBe(true)
  })

  it("pinta el estado desconocido en neutro y conserva el crudo", () => {
    // `unknown` no es un error: es un estado que no reconocemos, y en rojo se
    // leería como una plantilla rota. El crudo es lo único con lo que el cliente
    // puede buscarla en WhatsApp Manager.
    const row = toWhatsappTemplateRowView(
      template({ status: "unknown", rawStatus: "SOMETHING_NEW" })
    )

    expect(row.tone).toBe("neutral")
    expect(row.rawStatus).toBe("SOMETHING_NEW")
  })

  it("pinta de rojo lo que no se puede enviar y de espera lo que está en revisión", () => {
    expect(toWhatsappTemplateRowView(template()).tone).toBe("positive")
    expect(
      toWhatsappTemplateRowView(template({ status: "IN_REVIEW" })).tone
    ).toBe("pending")
    expect(toWhatsappTemplateRowView(template({ status: "PAUSED" })).tone).toBe(
      "negative"
    )
  })
})

describe("cómo se le cuenta al usuario un rechazo", () => {
  it("traduce por código y no repite el texto en inglés", () => {
    expect(
      describeWhatsappTemplateFailure({
        error: "template_not_owned",
        message: "This template was not created from Resender…",
      })
    ).toEqual({ key: "template_not_owned", detail: null })
  })

  it("conserva el texto de Meta cuando el rechazo es de Graph", () => {
    // Lo escribió `explainWhatsappTemplateAdminError` para que el cliente sepa
    // qué arreglar; nuestra traducción sólo puede decir «Meta lo rechazó».
    expect(
      describeWhatsappTemplateFailure({
        error: "template_create_failed",
        message: "A template with this name already exists.",
      })
    ).toEqual({
      key: "template_create_failed",
      detail: "A template with this name already exists.",
    })
  })

  it("cae en el comodín con el crudo cuando el código no tiene traducción", () => {
    // El catálogo de `template-admin.ts` puede crecer sin que esta pantalla se
    // entere: un código sin traducción tiene que producir un mensaje honesto y
    // no una clave rota en pantalla.
    expect(
      describeWhatsappTemplateFailure({
        error: "some_new_code",
        message: "Something specific happened.",
      })
    ).toEqual({ key: "unexpected", detail: "Something specific happened." })
  })
})

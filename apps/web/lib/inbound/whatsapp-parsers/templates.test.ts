import { describe, expect, it } from "vitest"

import { extractWhatsappTemplates } from "./batch"
import {
  TEMPLATE_CATEGORY_COMPLETED,
  TEMPLATE_CATEGORY_IMPENDING,
  TEMPLATE_QUALITY_DROP,
  TEMPLATE_STATUS_APPROVED,
  TEMPLATE_STATUS_REJECTED,
  WABA_ID,
  templateWebhook,
} from "./test-fixtures"

describe("WhatsApp template webhooks", () => {
  const statuses = (overrides: Record<string, unknown> = {}) =>
    extractWhatsappTemplates(
      templateWebhook("message_template_status_update", {
        ...TEMPLATE_STATUS_APPROVED,
        ...overrides,
      })
    )

  // El WABA sale de `entry.id` y no del `value`: es el único sitio del payload
  // donde viaja, y es un tercio de la clave del espejo.
  it("reads an approval carrying the mirror key and the Meta template id", () => {
    expect(
      extractWhatsappTemplates(
        templateWebhook(
          "message_template_status_update",
          TEMPLATE_STATUS_APPROVED
        )
      )
    ).toEqual([
      {
        wabaId: WABA_ID,
        // Meta lo manda como número; la columna `meta_template_id` es texto.
        metaTemplateId: "1689556908129832",
        name: "order_confirmation",
        language: "en-US",
        kind: "status",
        status: "APPROVED",
        reason: "NONE",
        category: "UTILITY",
        rejection: null,
      },
    ])
  })

  it("carries the rejection reason and the human recommendation", () => {
    expect(
      extractWhatsappTemplates(
        templateWebhook(
          "message_template_status_update",
          TEMPLATE_STATUS_REJECTED
        )
      )
    ).toEqual([
      {
        wabaId: WABA_ID,
        metaTemplateId: "1689556908129835",
        name: "abandoned_cart",
        language: "en",
        kind: "status",
        status: "REJECTED",
        reason: "INVALID_FORMAT",
        category: "MARKETING",
        rejection: {
          reason:
            "Your template has parameters placed next to each other (like {{1}}{{2}}) without text or punctuation between them.",
          recommendation:
            "Separate parameters with descriptive text and ensure each parameter is clearly contextualized.",
        },
      },
    ])
  })

  // **Este es el test que codifica la decisión de la 0014.** La columna `status`
  // no tiene check constraint justamente porque el catálogo de Meta no es
  // estable: usa `PENDING` en unas páginas e `IN_REVIEW` en otras y añade
  // valores como `LIMIT_EXCEEDED` sin cambiar de versión de API. Un estado que
  // no reconocemos deja el espejo menos exacto; descartarlo lo deja
  // desactualizado, que es peor, porque el envío decide contra él.
  //
  // Es lo contrario de lo que hace `statuses.ts`, y no son intercambiables:
  // allí la columna sí tiene un CHECK y un valor de relleno rompería el insert
  // del lote entero. Si alguien "unifica" los dos parsers, este test tiene que
  // ponerse rojo.
  it("keeps a status it does not recognise instead of dropping the event", () => {
    expect(statuses({ event: "LIMIT_EXCEEDED" })[0]).toMatchObject({
      kind: "status",
      status: "LIMIT_EXCEEDED",
    })

    // Ni siquiera algo que Meta no documenta en ninguna página se descarta: el
    // espejo prefiere un valor que no sabe leer a no enterarse del cambio.
    expect(statuses({ event: "TELETRANSPORTADA" })[0]).toMatchObject({
      status: "TELETRANSPORTADA",
    })
  })

  // Lo que sí se descarta es un evento que no se puede atribuir a ninguna fila:
  // sin clave no hay `update` posible y emitirlo solo trasladaría el callejón
  // sin salida al consumidor. No contradice al test de arriba —una cosa es no
  // saber a qué fila apunta y otra no reconocer el valor que trae—.
  it.each([
    ["el nombre", "message_template_name"],
    ["el idioma", "message_template_language"],
    ["el estado", "event"],
  ])("drops an event missing %s, which leaves no row to update", (_n, key) => {
    expect(statuses({ [key]: undefined })).toEqual([])
  })

  // La regresión que este parser estuvo a un `asString` de tener: el sobre leía
  // `entry.id` sólo como string y Meta lo manda como número JSON, así que el
  // WABA llegaba en null y `readIdentity` descartaba **todos** los eventos de
  // plantilla. Sin rastro en ninguna parte: el `field` matcheaba su `case`, así
  // que tampoco caían en `unhandledFields`.
  it("reads a numeric entry.id, which is how Meta actually sends the WABA", () => {
    const payload = templateWebhook(
      "message_template_status_update",
      TEMPLATE_STATUS_APPROVED
    )

    expect(
      extractWhatsappTemplates({
        ...payload,
        entry: [{ ...payload.entry[0]!, id: Number(WABA_ID) }],
      })[0]
    ).toMatchObject({ wabaId: WABA_ID, name: "order_confirmation" })
  })

  it("drops an event whose entry carries no WABA to key the mirror by", () => {
    expect(
      extractWhatsappTemplates({
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "message_template_status_update",
                value: TEMPLATE_STATUS_APPROVED,
              },
            ],
          },
        ],
      })
    ).toEqual([])
  })

  // La trampa del campo: en el aviso de recategorización inminente
  // `new_category` es la categoría **vigente** y `correct_category` la futura.
  // Escribir `correct_category` en el espejo adelantaría un cambio que todavía
  // no ocurrió.
  it("reads the impending recategorisation without applying it yet", () => {
    expect(
      extractWhatsappTemplates(
        templateWebhook("template_category_update", TEMPLATE_CATEGORY_IMPENDING)
      )
    ).toEqual([
      {
        wabaId: WABA_ID,
        metaTemplateId: "278077987957091",
        name: "welcome_template",
        language: "en-US",
        kind: "category",
        category: "UTILITY",
        previousCategory: null,
        pendingCategory: "MARKETING",
        pendingAt: new Date(1_746_169_200_000),
      },
    ])
  })

  it("reads the completed recategorisation with nothing pending", () => {
    expect(
      extractWhatsappTemplates(
        templateWebhook("template_category_update", TEMPLATE_CATEGORY_COMPLETED)
      )
    ).toEqual([
      {
        wabaId: WABA_ID,
        metaTemplateId: "278077987957091",
        name: "welcome_template",
        language: "en-US",
        kind: "category",
        category: "MARKETING",
        previousCategory: "UTILITY",
        pendingCategory: null,
        // Sin fecha pendiente se dice «no consta» y no «ya»: inventar un
        // `new Date()` aquí sería un plazo falso.
        pendingAt: null,
      },
    ])
  })

  // La caída de calidad no tiene columna donde guardarse y no la necesita: su
  // valor es llegar a la bitácora antes de que Meta pause el número, que es el
  // único freno del que nos enteramos (ADR 0014).
  it("reads a quality drop with both scores so the log can name the fall", () => {
    expect(
      extractWhatsappTemplates(
        templateWebhook(
          "message_template_quality_update",
          TEMPLATE_QUALITY_DROP
        )
      )
    ).toEqual([
      {
        wabaId: WABA_ID,
        metaTemplateId: "806312974732579",
        name: "welcome_template",
        language: "en-US",
        kind: "quality",
        qualityScore: "YELLOW",
        previousQualityScore: "GREEN",
      },
    ])
  })

  it("keeps a quality score outside the documented scale", () => {
    expect(
      extractWhatsappTemplates(
        templateWebhook("message_template_quality_update", {
          ...TEMPLATE_QUALITY_DROP,
          new_quality_score: "ULTRAVIOLETA",
        })
      )[0]
    ).toMatchObject({ kind: "quality", qualityScore: "ULTRAVIOLETA" })
  })

  // Es la regresión que el sobre tenía antes de esta entrega: `collectChanges`
  // exigía `metadata.phone_number_id` y los tres campos de plantilla llegan sin
  // él, así que se borraban del lote —y de `unhandledFields`— antes de que
  // ningún parser los viera.
  it("does not need a phone_number_id, which these payloads never carry", () => {
    const payload = templateWebhook(
      "message_template_status_update",
      TEMPLATE_STATUS_APPROVED
    )

    expect(payload.entry[0]!.changes[0]!.value).not.toHaveProperty("metadata")
    expect(extractWhatsappTemplates(payload)).toHaveLength(1)
  })
})

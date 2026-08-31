import { describe, expect, it } from "vitest"

import { es } from "@/content/i18n/app/es"
import { en } from "@/content/i18n/app/en"

import {
  formatContactLabel,
  formatDeliveryLabel,
  groupThreadReactions,
  toConversationRowView,
  toThreadMessageViews,
} from "./display"
import type { ConversationListItem, ThreadMessage } from "./read-model"

const NOW = new Date(2026, 6, 27, 15, 30)

function conversation(
  overrides: Partial<ConversationListItem> = {}
): ConversationListItem {
  return {
    id: "conv-1",
    contactId: "8837120041",
    contactName: null,
    contactUsername: null,
    contactSyncedAt: null,
    lastMessageAt: new Date(2026, 6, 27, 14, 2),
    page: {
      id: "page-1",
      channel: "messenger",
      metaPageId: "104233889761204",
      name: "Café Rioja",
      username: null,
      whatsappPhoneE164: null,
    },
    latestMessage: {
      text: "¿Hacen envíos a Palermo?",
      direction: "inbound",
      status: "received",
      createdAt: new Date(2026, 6, 27, 14, 2),
      attachmentType: null,
      templateMeta: null,
    },
    ...overrides,
  }
}

function message(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: "msg-1",
    channel: "messenger",
    direction: "inbound",
    status: "received",
    text: "Hola, ¿tienen turno para hoy?",
    error: null,
    instagramSourceCommentId: null,
    attachmentType: null,
    attachmentUrl: null,
    attachmentMeta: null,
    attachmentStatus: null,
    metaMessageId: null,
    replyToMetaMessageId: null,
    deliveryStatus: null,
    templateMeta: null,
    createdAt: new Date(2026, 6, 27, 14, 1, 29),
    ...overrides,
  }
}

describe("message display helpers", () => {
  it("falls back to a human-readable PSID label", () => {
    expect(formatContactLabel(null, "12345")).toBe("PSID 12345")
    expect(formatContactLabel("", "12345")).toBe("PSID 12345")
    expect(formatContactLabel("Ada", "12345")).toBe("Ada")
  })
})

describe("toConversationRowView", () => {
  it("identifica al contacto por @handle cuando Graph lo resolvió", () => {
    const row = toConversationRowView(
      conversation({
        contactUsername: "lori_surianno",
        contactName: "Lori",
        contactSyncedAt: new Date(2026, 6, 27, 12, 0),
      }),
      NOW,
      es
    )

    expect(row.contactLabel).toBe("@lori_surianno")
    expect(row.contactName).toBe("Lori")
  })

  it("no repite el nombre cuando es el mismo @handle", () => {
    // Instagram devuelve un montón de cuentas donde `name` y `username` son la
    // misma cadena; pintarla dos veces en el mismo renglón es ruido.
    const row = toConversationRowView(
      conversation({
        contactUsername: "cafe.rioja",
        contactName: "Cafe.Rioja",
        contactSyncedAt: new Date(2026, 6, 27, 12, 0),
      }),
      NOW,
      es
    )

    expect(row.contactLabel).toBe("@cafe.rioja")
    expect(row.contactName).toBeNull()
  })

  it("cae al PSID mientras no haya @handle", () => {
    // Es el caso de Messenger, donde no hay perfil que pedir, y el de una
    // conversación que todavía nadie miró.
    expect(toConversationRowView(conversation(), NOW, es).contactLabel).toBe(
      "psid 8837120041"
    )
    expect(
      toConversationRowView(conversation({ contactUsername: "  " }), NOW, es)
        .contactLabel
    ).toBe("psid 8837120041")
  })

  it("pone el último mensaje en el renglón principal", () => {
    const row = toConversationRowView(conversation(), NOW, es)

    expect(row.content).toBe("¿Hacen envíos a Palermo?")
    expect(row.hasMessages).toBe(true)
    expect(row.failed).toBe(false)
    expect(row.pageLabel).toBe("Café Rioja · 104233889761204")
    expect(row.channel).toBe("messenger")
    expect(row.timestamp).toBe("hoy 14:02")
  })

  it("identifica la cuenta por @handle cuando la conversación es de Instagram", () => {
    const row = toConversationRowView(
      conversation({
        page: {
          id: "page-2",
          channel: "instagram",
          metaPageId: "17841400000000000",
          name: "Café Rioja",
          username: "cafe.rioja",
          whatsappPhoneE164: null,
        },
      }),
      NOW,
      es
    )

    expect(row.pageLabel).toBe("@cafe.rioja · ig_id 17841400000000000")
    expect(row.channel).toBe("instagram")
  })

  it("cae al nombre de la cuenta si Instagram no dio el @handle", () => {
    const row = toConversationRowView(
      conversation({
        page: {
          id: "page-2",
          channel: "instagram",
          metaPageId: "17841400000000000",
          name: "Café Rioja",
          username: null,
          whatsappPhoneE164: null,
        },
      }),
      NOW,
      es
    )

    expect(row.pageLabel).toBe("Café Rioja · 17841400000000000")
  })

  it("prefija los salientes con «Tú: » y marca los fallidos", () => {
    const row = toConversationRowView(
      conversation({
        latestMessage: {
          text: "Te confirmo el turno del jueves.",
          direction: "outbound",
          status: "failed",
          createdAt: new Date(2026, 6, 26, 19, 12),
          attachmentType: null,
          templateMeta: null,
        },
        lastMessageAt: new Date(2026, 6, 26, 19, 12),
      }),
      NOW,
      es
    )

    expect(row.content).toBe("Tú: Te confirmo el turno del jueves.")
    expect(row.failed).toBe(true)
    expect(row.timestamp).toBe("ayer 19:12")
  })

  it("resuelve la conversación sin mensajes", () => {
    const row = toConversationRowView(
      conversation({ latestMessage: null }),
      NOW,
      es
    )

    expect(row.content).toBe(es.log.noMessages)
    expect(row.hasMessages).toBe(false)
    expect(row.failed).toBe(false)
  })

  it("muestra el type entre corchetes cuando el último mensaje es solo adjunto", () => {
    const row = toConversationRowView(
      conversation({
        latestMessage: {
          text: "",
          direction: "inbound",
          status: "received",
          createdAt: new Date(2026, 6, 27, 14, 2),
          attachmentType: "image",
          templateMeta: null,
        },
      }),
      NOW,
      es
    )

    expect(row.content).toBe("[image]")
    expect(row.hasMessages).toBe(true)
  })

  it("conserva el prefijo «Tú: » en el saliente solo adjunto", () => {
    const row = toConversationRowView(
      conversation({
        latestMessage: {
          text: "",
          direction: "outbound",
          status: "sent",
          createdAt: new Date(2026, 6, 27, 14, 2),
          attachmentType: "file",
          templateMeta: null,
        },
      }),
      NOW,
      es
    )

    expect(row.content).toBe("Tú: [file]")
  })

  it("no cambia el renglón cuando el último mensaje trae texto además del adjunto", () => {
    const row = toConversationRowView(
      conversation({
        latestMessage: {
          text: "Mirá la foto",
          direction: "inbound",
          status: "received",
          createdAt: new Date(2026, 6, 27, 14, 2),
          attachmentType: "image",
          templateMeta: null,
        },
      }),
      NOW,
      es
    )

    expect(row.content).toBe("Mirá la foto")
  })

  it("identifica la plantilla cuando el saliente no trae texto ni adjunto", () => {
    // Un envío de plantilla no tiene ni texto ni adjunto: sin esta rama el
    // renglón del log se quedaría en un «Tú: » a secas, que es la versión de
    // lista de la burbuja vacía que el ticket prohíbe (ADR 0014).
    const row = toConversationRowView(
      conversation({
        latestMessage: {
          text: "",
          direction: "outbound",
          status: "sent",
          createdAt: new Date(2026, 6, 27, 14, 2),
          attachmentType: null,
          templateMeta: {
            name: "order_update",
            language: "es",
            components: [
              { type: "body", parameters: [{ type: "text", text: "A-1024" }] },
            ],
          },
        },
      }),
      NOW,
      es
    )

    expect(row.content).toBe("Tú: plantilla · order_update · es")
  })
})

describe("toThreadMessageViews", () => {
  it("no deja en blanco la burbuja de un envío de plantilla", () => {
    // La fila de un envío de plantilla llega con `text = ''`, sin adjunto y con
    // todo el contenido en `template_meta` (0018). La vista tiene que traer ya
    // resuelto qué se pinta: el `.tsx` no corre bajo Vitest, así que si la
    // regla viviera ahí no habría forma de comprobar esto.
    const [view] = toThreadMessageViews(
      [
        message({
          channel: "whatsapp",
          direction: "outbound",
          status: "sent",
          text: "",
          templateMeta: {
            name: "order_update",
            language: "es",
            components: [
              { type: "body", parameters: [{ type: "text", text: "A-1024" }] },
            ],
          },
        }),
      ],
      es
    )

    expect(view?.text).toBe("")
    expect(view?.attachment).toBeNull()
    expect(view?.template).toEqual({
      label: "plantilla · order_update · es",
      values: ["A-1024"],
    })
  })

  it("deja `template` en null en todo lo que no es un envío de plantilla", () => {
    // Es la marca de «esto fue una plantilla» y por eso no hay bandera aparte:
    // un mensaje cualquiera —los tres canales, entrante o saliente— no trae
    // nada que decir acá.
    const [view] = toThreadMessageViews([message()], es)

    expect(view?.template).toBeNull()
  })

  it("compone el metadato y solo abre separador al cambiar de día", () => {
    const views = toThreadMessageViews(
      [
        message({ id: "a", createdAt: new Date(2026, 6, 26, 19, 12, 3) }),
        message({
          id: "b",
          direction: "outbound",
          status: "sent",
          text: "¡Sí! Te espero hoy a las 15:00 👍",
          createdAt: new Date(2026, 6, 27, 14, 2, 11),
        }),
        message({ id: "c", createdAt: new Date(2026, 6, 27, 14, 2, 40) }),
      ],
      es
    )

    expect(views.map((view) => view.dayLabel)).toEqual([
      "26 jul 2026",
      "27 jul 2026",
      null,
    ])
    expect(views[1]?.meta).toBe("outbound · 14:02:11 · sent")
    expect(views[1]?.outbound).toBe(true)
    expect(views[2]?.meta).toBe("inbound · 14:02:40 · received")
  })

  it("solo expone el error del proveedor en los mensajes fallidos", () => {
    const [failed, sent] = toThreadMessageViews(
      [
        message({
          id: "a",
          direction: "outbound",
          status: "failed",
          error: "OAuthException 190 · Error validating access token",
          createdAt: new Date(2026, 6, 27, 14, 5, 2),
        }),
        message({
          id: "b",
          direction: "outbound",
          status: "sent",
          error: "ruido que no debería pintarse",
          createdAt: new Date(2026, 6, 27, 14, 6, 0),
        }),
      ],
      es
    )

    expect(failed?.failed).toBe(true)
    expect(failed?.error).toBe(
      "OAuthException 190 · Error validating access token"
    )
    expect(failed?.meta).toBe("outbound · 14:05:02 · failed")
    expect(sent?.failed).toBe(false)
    expect(sent?.error).toBeNull()
  })

  it("marca la respuesta privada a un comentario, que es un DM como cualquier otro", () => {
    const [privateReply, plain] = toThreadMessageViews(
      [
        message({
          id: "a",
          direction: "outbound",
          status: "sent",
          instagramSourceCommentId: "17851400000000000",
          createdAt: new Date(2026, 6, 27, 14, 2, 11),
        }),
        message({
          id: "b",
          direction: "outbound",
          status: "sent",
          createdAt: new Date(2026, 6, 27, 14, 3, 0),
        }),
      ],
      es
    )

    expect(privateReply?.fromComment).toBe(true)
    expect(privateReply?.meta).toBe(
      "outbound · 14:02:11 · sent · respuesta a comentario"
    )
    expect(plain?.fromComment).toBe(false)
    expect(plain?.meta).toBe("outbound · 14:03:00 · sent")
  })

  it("resuelve el adjunto del mensaje sin tocar el texto", () => {
    // Texto + adjunto: la vista lleva los dos; el componente decide cómo
    // apilarlos, acá solo se comprueba que ninguno pisa al otro.
    const [withBoth] = toThreadMessageViews(
      [
        message({
          text: "Mirá la foto",
          attachmentType: "image",
          attachmentUrl: "https://cdn.fbsbx.com/v/foto?oh=abc",
        }),
      ],
      es
    )

    expect(withBoth?.text).toBe("Mirá la foto")
    expect(withBoth?.attachment).toEqual({
      kind: "image",
      url: "https://cdn.fbsbx.com/v/foto?oh=abc",
    })
  })

  it("deja el texto vacío y el adjunto poblado en el mensaje solo-adjunto", () => {
    const [onlyAttachment] = toThreadMessageViews(
      [
        message({
          text: "",
          attachmentType: "appointment_booking",
          attachmentMeta: { booking: { bookingId: "bk-778" } },
        }),
      ],
      es
    )

    expect(onlyAttachment?.text).toBe("")
    expect(onlyAttachment?.attachment).toEqual({
      kind: "row",
      label: "appointment_booking · bk-778",
      url: null,
    })
  })

  it("no arma adjunto cuando el mensaje no trae", () => {
    const [plainText] = toThreadMessageViews([message()], es)

    expect(plainText?.attachment).toBeNull()
  })
})

describe("formatPageLabel en WhatsApp", () => {
  it("identifica la cuenta por el número, con el phone_number_id de secundario", () => {
    // `metaPageId` acá es el `phone_number_id`: un entero opaco que no dice qué
    // número es. Mismo criterio que el `@handle · ig_id` de Instagram.
    const row = toConversationRowView(
      conversation({
        page: {
          id: "page-3",
          channel: "whatsapp",
          metaPageId: "109988776655443",
          name: "Café Rioja",
          username: null,
          whatsappPhoneE164: "+5491122334455",
        },
      }),
      NOW,
      es
    )

    expect(row.pageLabel).toBe(
      "+5491122334455 · phone_number_id 109988776655443"
    )
    expect(row.channel).toBe("whatsapp")
  })

  it("cae al nombre cuando la fila todavía no tiene el número", () => {
    const row = toConversationRowView(
      conversation({
        page: {
          id: "page-3",
          channel: "whatsapp",
          metaPageId: "109988776655443",
          name: "Café Rioja",
          username: null,
          whatsappPhoneE164: null,
        },
      }),
      NOW,
      es
    )

    expect(row.pageLabel).toBe("Café Rioja · 109988776655443")
  })
})

describe("formatDeliveryLabel", () => {
  it("prefija la entrega para no confundirla con el status interno", () => {
    // En la burbuja conviven dos `sent` que no significan lo mismo: el interno
    // es «se lo mandamos a Meta», el de entrega es «Meta lo mandó al teléfono».
    expect(formatDeliveryLabel("sent", es)).toBe("entrega: enviado")
    expect(formatDeliveryLabel("read", es)).toBe("entrega: leído")
    expect(formatDeliveryLabel("failed", es)).toBe("entrega: no entregado")
  })

  it("no dice nada mientras el proveedor no haya reportado", () => {
    expect(formatDeliveryLabel(null, es)).toBeNull()
  })

  it("le da texto propio a los seis estados", () => {
    // Seis estados, seis textos distintos, en los dos idiomas: dos que
    // coincidan hacen indistinguibles «lo mandamos» y «llegó».
    for (const dict of [es, en]) {
      const labels = Object.values(dict.log.delivery)
      expect(labels).toHaveLength(6)
      expect(new Set(labels).size).toBe(6)
    }
  })

  it("viaja en su propio campo de la vista, separado del `meta`", () => {
    const [view] = toThreadMessageViews(
      [
        message({
          channel: "whatsapp",
          direction: "outbound",
          status: "sent",
          deliveryStatus: "read",
          createdAt: new Date(2026, 6, 27, 14, 2, 11),
        }),
      ],
      es
    )

    expect(view?.meta).toBe("outbound · 14:02:11 · sent")
    expect(view?.delivery).toBe("entrega: leído")
  })

  it("es null en Messenger, que no reporta entrega", () => {
    const [view] = toThreadMessageViews([message()], es)
    expect(view?.delivery).toBeNull()
  })
})

describe("groupThreadReactions", () => {
  const reacted = message({
    id: "msg-a",
    channel: "whatsapp",
    metaMessageId: "wamid.AAA",
    text: "¿Hacen envíos a Palermo?",
    createdAt: new Date(2026, 6, 27, 14, 0, 0),
  })

  it("cuelga la reacción del mensaje al que apunta y no le da burbuja", () => {
    const { timeline, reactionsByMessageId } = groupThreadReactions([
      reacted,
      message({
        id: "msg-b",
        channel: "whatsapp",
        direction: "outbound",
        status: "sent",
        text: "",
        attachmentType: "reaction",
        attachmentMeta: { emoji: "👍" },
        replyToMetaMessageId: "wamid.AAA",
        metaMessageId: "wamid.BBB",
        createdAt: new Date(2026, 6, 27, 14, 0, 30),
      }),
    ])

    expect(timeline.map((entry) => entry.id)).toEqual(["msg-a"])
    expect(reactionsByMessageId["msg-a"]).toEqual([
      { id: "msg-b", emoji: "👍", outbound: true },
    ])
  })

  it("acumula varias reacciones sobre el mismo mensaje", () => {
    const { reactionsByMessageId } = groupThreadReactions([
      reacted,
      message({
        id: "msg-b",
        channel: "whatsapp",
        attachmentType: "reaction",
        text: "❤️",
        replyToMetaMessageId: "wamid.AAA",
        createdAt: new Date(2026, 6, 27, 14, 0, 30),
      }),
      message({
        id: "msg-c",
        channel: "whatsapp",
        direction: "outbound",
        status: "sent",
        attachmentType: "reaction",
        attachmentMeta: { emoji: "😂" },
        replyToMetaMessageId: "wamid.AAA",
        createdAt: new Date(2026, 6, 27, 14, 0, 40),
      }),
    ])

    expect(reactionsByMessageId["msg-a"]).toEqual([
      { id: "msg-b", emoji: "❤️", outbound: false },
      { id: "msg-c", emoji: "😂", outbound: true },
    ])
  })

  it("descarta la reacción retirada, que llega con el emoji en blanco", () => {
    // WhatsApp no manda un evento de borrado: manda la misma reacción vacía.
    const { timeline, reactionsByMessageId } = groupThreadReactions([
      reacted,
      message({
        id: "msg-b",
        channel: "whatsapp",
        attachmentType: "reaction",
        text: "",
        attachmentMeta: { emoji: "" },
        replyToMetaMessageId: "wamid.AAA",
        createdAt: new Date(2026, 6, 27, 14, 0, 30),
      }),
    ])

    expect(timeline.map((entry) => entry.id)).toEqual(["msg-a"])
    expect(reactionsByMessageId).toEqual({})
  })

  it("le devuelve la burbuja a la reacción cuyo target no está en el hilo", () => {
    // Pasa con lo anterior al import de historial: desaparecer en silencio es
    // peor que verse fea, el dato existe.
    const huerfana = message({
      id: "msg-b",
      channel: "whatsapp",
      attachmentType: "reaction",
      attachmentMeta: { emoji: "👍" },
      replyToMetaMessageId: "wamid.ZZZ",
      createdAt: new Date(2026, 6, 27, 14, 0, 30),
    })
    const { timeline, reactionsByMessageId } = groupThreadReactions([
      reacted,
      huerfana,
    ])

    expect(timeline.map((entry) => entry.id)).toEqual(["msg-a", "msg-b"])
    expect(reactionsByMessageId).toEqual({})
  })

  it("agrupa igual cuando la reacción llega antes que el mensaje reaccionado", () => {
    const { timeline, reactionsByMessageId } = groupThreadReactions([
      message({
        id: "msg-b",
        channel: "whatsapp",
        attachmentType: "reaction",
        attachmentMeta: { emoji: "👍" },
        replyToMetaMessageId: "wamid.AAA",
        createdAt: new Date(2026, 6, 27, 13, 0, 0),
      }),
      reacted,
    ])

    expect(timeline.map((entry) => entry.id)).toEqual(["msg-a"])
    expect(reactionsByMessageId["msg-a"]).toHaveLength(1)
  })

  it("la vista del hilo no pinta la reacción como burbuja", () => {
    const views = toThreadMessageViews(
      [
        reacted,
        message({
          id: "msg-b",
          channel: "whatsapp",
          attachmentType: "reaction",
          attachmentMeta: { emoji: "👍" },
          replyToMetaMessageId: "wamid.AAA",
          createdAt: new Date(2026, 6, 27, 14, 0, 30),
        }),
      ],
      es
    )

    expect(views).toHaveLength(1)
    expect(views[0]?.reactions).toEqual([
      { id: "msg-b", emoji: "👍", outbound: false },
    ])
  })
})

describe("media de WhatsApp en el hilo", () => {
  const NOW_MEDIA = new Date(2026, 6, 27, 15, 30)

  it("apunta a la ruta propia y no a la URL firmada de Meta", () => {
    // La firmada de Cloud API dura cinco minutos: un <img src> ahí se rompe
    // siempre. La copia que dura es la de R2 y la sirve nuestra ruta.
    const [view] = toThreadMessageViews(
      [
        message({
          id: "msg-media",
          channel: "whatsapp",
          text: "",
          attachmentType: "image",
          attachmentUrl: "https://lookaside.fbsbx.com/whatsapp/expira",
          attachmentStatus: "available",
          createdAt: new Date(2026, 6, 27, 14, 0, 0),
        }),
      ],
      es,
      NOW_MEDIA
    )

    expect(view?.attachment).toEqual({
      kind: "image",
      url: "/api/meta/whatsapp/media/msg-media",
    })
  })

  it("no da URL cuando el objeto ya venció, y lo explica", () => {
    // El estado se deriva de la edad de la fila (`effectiveStatus`): un solo
    // reloj, el mismo que cuenta la lifecycle rule de R2.
    const [view] = toThreadMessageViews(
      [
        message({
          id: "msg-media",
          channel: "whatsapp",
          text: "",
          attachmentType: "image",
          attachmentStatus: "available",
          createdAt: new Date(2025, 11, 1, 10, 0, 0),
        }),
      ],
      es,
      NOW_MEDIA
    )

    expect(view?.attachment).toEqual({
      kind: "row",
      label: "image · archivo expirado",
      url: null,
    })
  })

  it("distingue «nunca lo hubo» de «no se pudo descargar»", () => {
    const [nunca, fallido] = toThreadMessageViews(
      [
        message({
          id: "msg-1",
          channel: "whatsapp",
          text: "",
          attachmentType: "image",
          attachmentStatus: "unavailable",
          createdAt: new Date(2026, 6, 27, 14, 0, 0),
        }),
        message({
          id: "msg-2",
          channel: "whatsapp",
          text: "",
          attachmentType: "audio",
          attachmentStatus: "failed",
          createdAt: new Date(2026, 6, 27, 14, 1, 0),
        }),
      ],
      es,
      NOW_MEDIA
    )

    expect(nunca?.attachment).toEqual({
      kind: "row",
      label: "image · WhatsApp no conserva archivos de más de 14 días",
      url: null,
    })
    expect(fallido?.attachment).toEqual({
      kind: "row",
      label: "audio · no se pudo descargar",
      url: null,
    })
  })

  it("deja intacta la URL del CDN en Messenger e Instagram", () => {
    const [view] = toThreadMessageViews(
      [
        message({
          channel: "instagram",
          text: "",
          attachmentType: "image",
          attachmentUrl: "https://cdn.fbsbx.com/v/foto?oh=abc",
        }),
      ],
      es,
      NOW_MEDIA
    )

    expect(view?.attachment).toEqual({
      kind: "image",
      url: "https://cdn.fbsbx.com/v/foto?oh=abc",
    })
  })
})

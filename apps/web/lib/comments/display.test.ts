import { describe, expect, it } from "vitest"

import { es } from "@/content/i18n/app/es"

import {
  formatAccountLabel,
  formatCommentAuthorLabel,
  formatCommentCount,
  formatMediaLabel,
  formatPublicationKey,
  toCommentBubbleViews,
  toPublicationRowView,
} from "./display"
import type { PublicationComment, PublicationListItem } from "./read-model"

const NOW = new Date(2026, 6, 27, 15, 30)

function publication(
  overrides: Partial<PublicationListItem> = {}
): PublicationListItem {
  return {
    connectedPageId: "8f2f0e64-0000-4000-8000-000000000001",
    mediaId: "17841400000000000",
    mediaProductType: "REELS",
    commentCount: 12,
    lastCommentAt: new Date(2026, 6, 27, 14, 2),
    account: {
      channel: "instagram",
      metaPageId: "17841499999999999",
      name: "Café Rioja",
      username: "cafe.rioja",
    },
    latestComment: {
      text: "¿cuánto sale?",
      direction: "inbound",
      status: "received",
      fromIgId: "178414123456789",
      fromUsername: "juanpi",
      createdAt: new Date(2026, 6, 27, 14, 2),
    },
    ...overrides,
  }
}

function comment(
  overrides: Partial<PublicationComment> = {}
): PublicationComment {
  return {
    id: "com-1",
    igCommentId: "17851400000000001",
    parentIgCommentId: null,
    direction: "inbound",
    status: "received",
    text: "¿cuánto sale?",
    error: null,
    fromIgId: "178414123456789",
    fromUsername: "juanpi",
    createdAt: new Date(2026, 6, 27, 14, 2, 11),
    ...overrides,
  }
}

describe("formatCommentAuthorLabel", () => {
  it("prefiere el @handle, que es lo que el usuario reconoce", () => {
    expect(
      formatCommentAuthorLabel({ fromUsername: "juanpi", fromIgId: "178414" })
    ).toBe("@juanpi")
  })

  it("cae al IGSID cuando Meta no manda el handle", () => {
    expect(
      formatCommentAuthorLabel({ fromUsername: null, fromIgId: "178414" })
    ).toBe("igsid 178414")
    expect(
      formatCommentAuthorLabel({ fromUsername: "   ", fromIgId: "178414" })
    ).toBe("igsid 178414")
  })
})

describe("formatMediaLabel", () => {
  it("prefiere el caption, que es lo único que identifica la publicación", () => {
    expect(
      formatMediaLabel(
        {
          mediaId: "17841400000000000",
          mediaProductType: "REELS",
          caption: "New website made with Claude Code",
        },
        es
      )
    ).toBe("New website made with Claude Code")
  })

  it("recorta el caption a la primera línea y a 60 caracteres", () => {
    // Un caption real termina en párrafos de hashtags que no identifican nada.
    expect(
      formatMediaLabel(
        {
          mediaId: "17841400000000000",
          mediaProductType: "REELS",
          caption:
            "Pido disculpas de antemano a los contadores\n#contadores #app",
        },
        es
      )
    ).toBe("Pido disculpas de antemano a los contadores")

    expect(
      formatMediaLabel(
        {
          mediaId: "17841400000000000",
          mediaProductType: "REELS",
          caption: "a".repeat(80),
        },
        es
      )
    ).toBe(`${"a".repeat(60)}…`)
  })

  it("cae al id cuando el caption está vacío o todavía no se resolvió", () => {
    const mediaId = "17841400000000000"

    expect(formatMediaLabel({ mediaId, mediaProductType: "REELS" }, es)).toBe(
      `reel ${mediaId}`
    )
    expect(
      formatMediaLabel(
        { mediaId, mediaProductType: "REELS", caption: null },
        es
      )
    ).toBe(`reel ${mediaId}`)
    expect(
      formatMediaLabel(
        { mediaId, mediaProductType: "REELS", caption: "\n  " },
        es
      )
    ).toBe(`reel ${mediaId}`)
  })

  it("nombra la clase de publicación que dio Meta", () => {
    const mediaId = "17841400000000000"

    expect(formatMediaLabel({ mediaId, mediaProductType: "FEED" }, es)).toBe(
      `publicación ${mediaId}`
    )
    expect(formatMediaLabel({ mediaId, mediaProductType: "REELS" }, es)).toBe(
      `reel ${mediaId}`
    )
    expect(formatMediaLabel({ mediaId, mediaProductType: "STORY" }, es)).toBe(
      `historia ${mediaId}`
    )
    expect(formatMediaLabel({ mediaId, mediaProductType: "AD" }, es)).toBe(
      `anuncio ${mediaId}`
    )
    expect(formatMediaLabel({ mediaId, mediaProductType: " reels " }, es)).toBe(
      `reel ${mediaId}`
    )
  })

  it("cae en «publicación» con un tipo desconocido o ausente", () => {
    const mediaId = "17841400000000000"

    expect(formatMediaLabel({ mediaId, mediaProductType: null }, es)).toBe(
      `publicación ${mediaId}`
    )
    expect(
      formatMediaLabel({ mediaId, mediaProductType: "CAROUSEL_V2" }, es)
    ).toBe(`publicación ${mediaId}`)
  })
})

describe("formatCommentCount", () => {
  it("singulariza el uno", () => {
    expect(formatCommentCount(1, es)).toBe("1 comentario")
    expect(formatCommentCount(12, es)).toBe("12 comentarios")
  })
})

describe("formatAccountLabel", () => {
  it("identifica la cuenta por @handle y cae al nombre si no hay", () => {
    expect(
      formatAccountLabel({
        name: "Café Rioja",
        username: "cafe.rioja",
        metaPageId: "17841",
      })
    ).toBe("@cafe.rioja · ig_id 17841")
    expect(
      formatAccountLabel({
        name: "Café Rioja",
        username: null,
        metaPageId: "17841",
      })
    ).toBe("Café Rioja · ig_id 17841")
  })
})

describe("formatPublicationKey", () => {
  it("compone el par, porque media_id solo es único dentro de la cuenta", () => {
    expect(
      formatPublicationKey({ connectedPageId: "page-1", mediaId: "17841" })
    ).toBe("page-1:17841")
  })
})

describe("toPublicationRowView", () => {
  it("pone el último comentario en el renglón principal", () => {
    const row = toPublicationRowView(publication(), NOW, es)

    expect(row.key).toBe(
      "8f2f0e64-0000-4000-8000-000000000001:17841400000000000"
    )
    expect(row.content).toBe("¿cuánto sale?")
    expect(row.mediaLabel).toBe("reel 17841400000000000")
    expect(row.mediaPermalink).toBeNull()
    expect(row.accountLabel).toBe("@cafe.rioja · ig_id 17841499999999999")
    expect(row.countLabel).toBe("12 comentarios")
    expect(row.timestamp).toBe("hoy 14:02")
    expect(row.failed).toBe(false)
  })

  it("usa el caption y el permalink cuando Graph los resolvió", () => {
    const row = toPublicationRowView(publication(), NOW, es, {
      permalink: "https://www.instagram.com/reel/DaYn7QRSZXn/",
      caption: "New website made with Claude Code\n#claudecode",
    })

    expect(row.mediaLabel).toBe("New website made with Claude Code")
    expect(row.mediaPermalink).toBe(
      "https://www.instagram.com/reel/DaYn7QRSZXn/"
    )
  })

  it("cae al id si Graph resolvió el permalink pero la publicación no tiene caption", () => {
    const row = toPublicationRowView(publication(), NOW, es, {
      permalink: "https://www.instagram.com/reel/DaYn7QRSZXn/",
      caption: null,
    })

    expect(row.mediaLabel).toBe("reel 17841400000000000")
    expect(row.mediaPermalink).toBe(
      "https://www.instagram.com/reel/DaYn7QRSZXn/"
    )
  })

  it("prefija las respuestas propias con «Tú: » y marca las rechazadas", () => {
    const row = toPublicationRowView(
      publication({
        lastCommentAt: new Date(2026, 6, 26, 19, 12),
        latestComment: {
          text: "Te paso el precio por DM 👋",
          direction: "outbound",
          status: "failed",
          fromIgId: "17841499999999999",
          fromUsername: "cafe.rioja",
          createdAt: new Date(2026, 6, 26, 19, 12),
        },
      }),
      NOW,
      es
    )

    expect(row.content).toBe("Tú: Te paso el precio por DM 👋")
    expect(row.failed).toBe(true)
    expect(row.timestamp).toBe("ayer 19:12")
  })
})

describe("toCommentBubbleViews", () => {
  it("nombra al autor y solo abre separador al cambiar de día", () => {
    const views = toCommentBubbleViews(
      [
        comment({ id: "a", createdAt: new Date(2026, 6, 26, 19, 12, 3) }),
        comment({
          id: "b",
          igCommentId: "17851400000000002",
          direction: "outbound",
          status: "sent",
          text: "Te paso el precio por DM 👋",
          fromIgId: "17841499999999999",
          fromUsername: "cafe.rioja",
          createdAt: new Date(2026, 6, 27, 14, 2, 11),
        }),
        comment({ id: "c", createdAt: new Date(2026, 6, 27, 14, 2, 40) }),
      ],
      es
    )

    expect(views.map((view) => view.dayLabel)).toEqual([
      "26 jul 2026",
      "27 jul 2026",
      null,
    ])
    expect(views[1]?.meta).toBe("@cafe.rioja · outbound · 14:02:11 · sent")
    expect(views[1]?.outbound).toBe(true)
    expect(views[2]?.meta).toBe("@juanpi · inbound · 14:02:40 · received")
  })

  it("nombra a quién contesta un saliente cuando el padre está en el hilo", () => {
    const [, reply] = toCommentBubbleViews(
      [
        comment({ id: "a", igCommentId: "17851400000000001" }),
        comment({
          id: "b",
          igCommentId: "17851400000000002",
          parentIgCommentId: "17851400000000001",
          direction: "outbound",
          status: "sent",
          text: "Te paso el precio por DM 👋",
          fromIgId: "17841499999999999",
          fromUsername: "cafe.rioja",
          createdAt: new Date(2026, 6, 27, 14, 3, 0),
        }),
      ],
      es
    )

    expect(reply?.meta).toBe(
      "@cafe.rioja · outbound · 14:03:00 · sent · respondiendo a @juanpi"
    )
  })

  it("no inventa un padre que no está en el hilo", () => {
    const [orphan] = toCommentBubbleViews(
      [
        comment({
          id: "b",
          igCommentId: "17851400000000002",
          parentIgCommentId: "17851499999999999",
          direction: "outbound",
          status: "sent",
          fromUsername: "cafe.rioja",
          createdAt: new Date(2026, 6, 27, 14, 3, 0),
        }),
      ],
      es
    )

    expect(orphan?.meta).toBe("@cafe.rioja · outbound · 14:03:00 · sent")
  })

  it("solo expone el error del proveedor en las respuestas rechazadas", () => {
    const [failed, sent] = toCommentBubbleViews(
      [
        comment({
          id: "a",
          igCommentId: null,
          direction: "outbound",
          status: "failed",
          error: "OAuthException 190 · Error validating access token",
          createdAt: new Date(2026, 6, 27, 14, 5, 2),
        }),
        comment({
          id: "b",
          igCommentId: "17851400000000003",
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
    expect(sent?.failed).toBe(false)
    expect(sent?.error).toBeNull()
  })
})

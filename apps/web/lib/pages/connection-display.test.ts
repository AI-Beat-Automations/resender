import { describe, expect, it } from "vitest"

import type { PageChannel } from "./page-registry"
import {
  CHANNEL_LABEL,
  CHANNEL_NOUN,
  COEXISTENCE_LIMITS,
  HISTORY_SYNC_NOTICE,
  ONBOARDING_MODE_LABEL,
  formatConnectionIdentity,
  resolveHistorySyncNotice,
  resolveReconnectHref,
  showsCoexistenceLimits,
  type ConnectionIdentityInput,
  type HistorySyncStatus,
} from "./connection-display"

const CHANNELS: PageChannel[] = ["messenger", "instagram", "whatsapp"]

const HISTORY_SYNC_STATUSES: HistorySyncStatus[] = [
  "not_requested",
  "requested",
  "in_progress",
  "complete",
  "failed",
  "expired",
]

function page(
  overrides: Partial<ConnectionIdentityInput> = {}
): ConnectionIdentityInput {
  return {
    channel: "messenger",
    name: "Café Rioja",
    username: null,
    metaPageId: "104233889761204",
    wabaId: null,
    whatsappPhoneE164: null,
    ...overrides,
  }
}

describe("catálogos por canal", () => {
  it("nombra los tres canales y no cae en Messenger por descarte", () => {
    // El bug que motiva el Record: con `instagram ? "Instagram" : "Messenger"`
    // WhatsApp se pintaba «Messenger» y nada fallaba.
    expect(CHANNEL_LABEL.whatsapp).toBe("WhatsApp")
    for (const channel of CHANNELS) {
      expect(CHANNEL_LABEL[channel]).toBeTruthy()
      expect(CHANNEL_NOUN[channel]).toBeTruthy()
    }
    expect(new Set(Object.values(CHANNEL_LABEL)).size).toBe(CHANNELS.length)
  })

  it("manda cada canal a su propio diálogo de Meta", () => {
    expect(resolveReconnectHref({ channel: "messenger" })).toBe(
      "/api/meta/start"
    )
    expect(resolveReconnectHref({ channel: "instagram" })).toBe(
      "/api/meta/instagram/start"
    )
    expect(resolveReconnectHref({ channel: "whatsapp" })).toBe(
      "/api/meta/whatsapp/start"
    )
  })

  it("reconecta WhatsApp por el único punto de entrada que hay", () => {
    // Sin `?mode=`: los dos flujos salen del mismo diálogo y el modo lo deriva
    // el evento de cierre, no el enlace que trajo al usuario hasta el botón.
    expect(resolveReconnectHref({ channel: "whatsapp" })).not.toContain("mode=")
  })
})

describe("formatConnectionIdentity", () => {
  it("identifica una página de Facebook por su nombre y su page_id", () => {
    expect(formatConnectionIdentity(page())).toEqual({
      title: "Café Rioja",
      identity: "page_id 104233889761204",
    })
  })

  it("identifica Instagram por @handle, con el IG ID de secundario", () => {
    expect(
      formatConnectionIdentity(
        page({
          channel: "instagram",
          username: "cafe.rioja",
          metaPageId: "17841400000000000",
        })
      )
    ).toEqual({
      title: "Café Rioja",
      identity: "@cafe.rioja · ig_id 17841400000000000",
    })
  })

  it("identifica WhatsApp por el número visible, con el WABA de secundario", () => {
    // `meta_page_id` acá es el `phone_number_id`: un entero opaco que no dice
    // ni qué número es ni a qué WABA pertenece.
    expect(
      formatConnectionIdentity(
        page({
          channel: "whatsapp",
          name: "Café Rioja",
          metaPageId: "109988776655443",
          wabaId: "223344556677889",
          whatsappPhoneE164: "+5491122334455",
        })
      )
    ).toEqual({
      title: "+5491122334455",
      identity: "waba_id 223344556677889 · phone_number_id 109988776655443",
    })
  })

  it("cae al nombre sin número y dice el WABA ausente en vez de esconderlo", () => {
    expect(
      formatConnectionIdentity(
        page({ channel: "whatsapp", metaPageId: "109988776655443" })
      )
    ).toEqual({
      title: "Café Rioja",
      identity: "waba_id — · phone_number_id 109988776655443",
    })
  })
})

describe("resolveHistorySyncNotice", () => {
  it("no dibuja nada fuera de WhatsApp", () => {
    // Una fila de Messenger con `history_sync_status` poblado es un dato
    // imposible; el guard evita que un backfill raro pinte la sección.
    expect(
      resolveHistorySyncNotice({
        channel: "messenger",
        historySyncStatus: "complete",
      })
    ).toBeNull()
    expect(
      resolveHistorySyncNotice({
        channel: "whatsapp",
        historySyncStatus: null,
      })
    ).toBeNull()
  })

  it("cubre los seis estados con copy propio", () => {
    for (const status of HISTORY_SYNC_STATUSES) {
      const notice = resolveHistorySyncNotice({
        channel: "whatsapp",
        historySyncStatus: status,
      })
      expect(notice).toBe(HISTORY_SYNC_NOTICE[status])
      expect(notice?.body).toBeTruthy()
      expect(notice?.label).toBeTruthy()
    }
    const bodies = HISTORY_SYNC_STATUSES.map(
      (status) => HISTORY_SYNC_NOTICE[status].body
    )
    expect(new Set(bodies).size).toBe(HISTORY_SYNC_STATUSES.length)
  })

  it("solo `failed` y `expired` traen acción: en el resto un botón sería ruido", () => {
    const withAction = HISTORY_SYNC_STATUSES.filter(
      (status) => HISTORY_SYNC_NOTICE[status].actionLabel !== null
    )
    expect(withAction).toEqual(["failed", "expired"])
  })

  it("`expired` dice el plazo de 24 horas y que hay que rehacerla desde el Embedded Signup", () => {
    // Es el requisito literal del PRD: un «error al sincronizar» genérico deja
    // al usuario esperando un reintento que no existe.
    const expired = HISTORY_SYNC_NOTICE.expired
    expect(expired.body).toContain("24 horas")
    expect(expired.body).toContain("Embedded Signup")
    expect(expired.body).toContain("rehacerla")
    expect(expired.tone).toBe("danger")
  })

  it("`complete` no promete mensajes: cero historial compartido es válido", () => {
    expect(HISTORY_SYNC_NOTICE.complete.tone).toBe("success")
    expect(HISTORY_SYNC_NOTICE.complete.body).toContain("no compartir")
  })
})

describe("limitaciones de Coexistence", () => {
  it("solo se explican en un número de Coexistence", () => {
    expect(
      showsCoexistenceLimits({
        channel: "whatsapp",
        onboardingMode: "coexistence",
      })
    ).toBe(true)
    expect(
      showsCoexistenceLimits({
        channel: "whatsapp",
        onboardingMode: "standard",
      })
    ).toBe(false)
    expect(
      showsCoexistenceLimits({ channel: "messenger", onboardingMode: null })
    ).toBe(false)
  })

  it("declara el techo de 20 mensajes por segundo y que la elegibilidad la decide Meta", () => {
    const text = COEXISTENCE_LIMITS.join(" ")
    expect(text).toContain("20 mensajes por segundo")
    expect(text).toContain("La elegibilidad la decide Meta")
    expect(COEXISTENCE_LIMITS).toHaveLength(2)
  })

  it("nombra los dos flujos de alta con la copy de los botones", () => {
    expect(ONBOARDING_MODE_LABEL.standard).toContain("número nuevo")
    expect(ONBOARDING_MODE_LABEL.coexistence).toContain("Coexistence")
  })
})

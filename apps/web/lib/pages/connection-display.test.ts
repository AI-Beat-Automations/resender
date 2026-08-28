import { describe, expect, it } from "vitest"

import { es } from "@/content/i18n/app/es"
import { en } from "@/content/i18n/app/en"

import type { PageChannel } from "./page-registry"
import {
  HISTORY_SYNC_TONE,
  formatConnectionIdentity,
  offersPinReveal,
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
    expect(es.channels.label.whatsapp).toBe("WhatsApp")
    for (const channel of CHANNELS) {
      for (const dict of [es, en]) {
        expect(dict.channels.label[channel]).toBeTruthy()
        expect(dict.channels.noun[channel]).toBeTruthy()
        expect(dict.channels.tokenInvalidBody[channel]).toBeTruthy()
      }
    }
    for (const dict of [es, en]) {
      expect(new Set(Object.values(dict.channels.label)).size).toBe(
        CHANNELS.length
      )
    }
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
      resolveHistorySyncNotice(
        { channel: "messenger", historySyncStatus: "complete" },
        es
      )
    ).toBeNull()
    expect(
      resolveHistorySyncNotice(
        { channel: "whatsapp", historySyncStatus: null },
        es
      )
    ).toBeNull()
  })

  it("cubre los seis estados con copy propio, en los dos idiomas", () => {
    for (const dict of [es, en]) {
      for (const status of HISTORY_SYNC_STATUSES) {
        const notice = resolveHistorySyncNotice(
          { channel: "whatsapp", historySyncStatus: status },
          dict
        )
        expect(notice?.body).toBe(dict.channels.historySync[status].body)
        expect(notice?.label).toBeTruthy()
        // El tono es del módulo, no del diccionario: no se traduce.
        expect(notice?.tone).toBe(HISTORY_SYNC_TONE[status])
      }
      const bodies = HISTORY_SYNC_STATUSES.map(
        (status) => dict.channels.historySync[status].body
      )
      expect(new Set(bodies).size).toBe(HISTORY_SYNC_STATUSES.length)
    }
  })

  it("solo `failed` y `expired` traen acción: en el resto un botón sería ruido", () => {
    // La regla es del dominio, así que vale en los dos idiomas: un traductor no
    // puede hacer aparecer un botón poniendo texto donde había `null`.
    for (const dict of [es, en]) {
      const withAction = HISTORY_SYNC_STATUSES.filter(
        (status) => dict.channels.historySync[status].actionLabel !== null
      )
      expect(withAction).toEqual(["failed", "expired"])
    }
  })

  it("`expired` dice el plazo de 24 horas y que hay que rehacerla desde el Embedded Signup", () => {
    // Es el requisito literal del PRD: un «error al sincronizar» genérico deja
    // al usuario esperando un reintento que no existe.
    expect(es.channels.historySync.expired.body).toContain("24 horas")
    expect(es.channels.historySync.expired.body).toContain("Embedded Signup")
    expect(es.channels.historySync.expired.body).toContain("rehacerla")
    expect(en.channels.historySync.expired.body).toContain("24-hour")
    expect(en.channels.historySync.expired.body).toContain("Embedded Signup")
    expect(HISTORY_SYNC_TONE.expired).toBe("danger")
  })

  it("`complete` no promete mensajes: cero historial compartido es válido", () => {
    expect(HISTORY_SYNC_TONE.complete).toBe("success")
    expect(es.channels.historySync.complete.body).toContain("no compartir")
    expect(en.channels.historySync.complete.body).toContain("not to share")
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
    expect(es.channels.coexistenceLimits.join(" ")).toContain(
      "20 mensajes por segundo"
    )
    expect(es.channels.coexistenceLimits.join(" ")).toContain(
      "La elegibilidad la decide Meta"
    )
    expect(en.channels.coexistenceLimits.join(" ")).toContain(
      "20 messages per second"
    )
    // Los dos límites son de Meta y ninguno se puede dejar de decir al
    // traducir: si uno se cae, el cliente lo descubre cuando ya es tarde.
    for (const dict of [es, en]) {
      expect(dict.channels.coexistenceLimits).toHaveLength(2)
    }
  })

  it("nombra los dos flujos de alta con la copy de los botones", () => {
    expect(es.channels.onboardingMode.standard).toContain("número nuevo")
    expect(es.channels.onboardingMode.coexistence).toContain("Coexistence")
    expect(en.channels.onboardingMode.standard).toContain("new number")
    expect(en.channels.onboardingMode.coexistence).toContain("Coexistence")
  })
})

describe("PIN de verificación en dos pasos", () => {
  // El caso que obliga a la columna `whatsapp_pin_generated`: cifrados, el PIN
  // nuestro y el del cliente se ven igual, y solo el nuestro hay que devolverlo.
  it("ofrece revelar solo el PIN que generamos nosotros", () => {
    expect(
      offersPinReveal({ channel: "whatsapp", whatsappPinGenerated: true })
    ).toBe(true)
    expect(
      offersPinReveal({ channel: "whatsapp", whatsappPinGenerated: false })
    ).toBe(false)
  })

  it("no lo ofrece en los canales que no tienen PIN", () => {
    expect(
      offersPinReveal({ channel: "messenger", whatsappPinGenerated: true })
    ).toBe(false)
    expect(
      offersPinReveal({ channel: "instagram", whatsappPinGenerated: true })
    ).toBe(false)
  })
})

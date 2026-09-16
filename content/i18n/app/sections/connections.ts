import type { WhatsappOnboardingMode } from "@/lib/pages/connection-display"

export type ConnectionsDict = {
  eyebrow: string
  title: string
  subtitle: string
  connectFacebook: string
  connectInstagram: string
  connectWhatsapp: string
  /** `{description}` del único punto de entrada de WhatsApp. */
  whatsappEntryDescription: string
  whatsappModeCaveat: Record<WhatsappOnboardingMode, string>
  connectedAccountsHeading: string
  /** `{activePageCount}`, `{maxPages}` */
  quota: string
  /** Sufijo del contador `n / m` de la cabecera. */
  quotaActiveSuffix: string
  quotaUnresolved: string
  noticeConnectedGeneric: string
  /** `{username}` */
  noticeInstagramNamed: string
  noticeInstagram: string
  /** `{list}` */
  noticeConnectedOne: string
  /** `{count}`, `{list}` */
  noticeConnectedMany: string
  /** Conjunción de la lista de páginas conectadas: `A, B y C`. */
  listConjunction: string
  empty: {
    facebookTitle: string
    facebookBody: string
    instagramTitle: string
    instagramBody: string
    whatsappTitle: string
    whatsappBody: string
    title: string
    body: string
    /** Sin numerar: el número lo dibuja la píldora. */
    step1: string
    step2: string
    step3: string
  }
}

export const es: ConnectionsDict = {
  eyebrow: "conexiones",
  title: "Conexiones",
  subtitle:
    "Conecta tus páginas de Facebook, tus cuentas de Instagram y tus números de WhatsApp, configura un webhook por cuenta y desconecta canales sin borrar el historial.",
  connectFacebook: "Conectar Facebook",
  connectInstagram: "Conectar Instagram",
  connectWhatsapp: "Conectar WhatsApp",
  whatsappEntryDescription:
    "Meta abre su ventana y ahí eliges: dar de alta un número nuevo, o conectar el que ya usas en la app de WhatsApp Business. No da lo mismo cuál —cada opción deja el número de una manera distinta— y te contamos qué implica la que elijas en cuanto la ventana se cierre.",
  whatsappModeCaveat: {
    standard:
      "Diste de alta un número nuevo en la API de WhatsApp: queda registrado para la API y deja de poder usarse desde la app de WhatsApp Business.",
    coexistence:
      "Conectaste el número que ya usas en la app de WhatsApp Business: sigue funcionando ahí y además llega a Resender. Meta decide la elegibilidad y el número queda con un techo fijo de 20 mensajes por segundo. El historial hay que sincronizarlo dentro de las 24 horas siguientes.",
  },
  connectedAccountsHeading: "CUENTAS CONECTADAS",
  quota: "{activePageCount} de {maxPages} conexiones",
  quotaActiveSuffix: "conexiones activas",
  quotaUnresolved: "cupo sin resolver · escríbenos a info@resender.dev",
  noticeConnectedGeneric: "Conectado: la autorización se completó.",
  noticeInstagramNamed:
    "Conectado: la cuenta de Instagram @{username} quedó autorizada.",
  noticeInstagram: "Conectado: la cuenta de Instagram quedó autorizada.",
  noticeConnectedOne: "Conectado: 1 página autorizada — {list}.",
  noticeConnectedMany: "Conectado: {count} páginas autorizadas — {list}.",
  listConjunction: "y",
  empty: {
    facebookTitle: "Facebook",
    facebookBody:
      "Autoriza tus páginas desde Meta para empezar a recibir mensajes.",
    instagramTitle: "Instagram",
    instagramBody:
      "Autoriza tu cuenta profesional para recibir mensajes directos y comentarios. No necesitas una página de Facebook.",
    whatsappTitle: "WhatsApp",
    whatsappBody:
      "Da de alta un número nuevo, o conecta el que ya usas en WhatsApp Business App sin dejar de usarlo desde el teléfono. Solo se puede responder dentro de las 24 horas posteriores al último mensaje del cliente.",
    title: "Todavía no hay cuentas conectadas.",
    body: "Cuando autorices una cuenta aparecerá acá, con su webhook y su estado. Reconectar actualiza el token y los metadatos sin duplicar cuentas.",
    step1: "autorizas la cuenta",
    step2: "apuntas tu webhook",
    step3: "llega el primer mensaje",
  },
}

export const en: ConnectionsDict = {
  eyebrow: "connections",
  title: "Connections",
  subtitle:
    "Connect your Facebook pages, your Instagram accounts and your WhatsApp numbers, set a webhook per account, and disconnect channels without deleting history.",
  connectFacebook: "Connect Facebook",
  connectInstagram: "Connect Instagram",
  connectWhatsapp: "Connect WhatsApp",
  whatsappEntryDescription:
    "Meta opens its window and you choose there: register a new number, or connect the one you already use in the WhatsApp Business app. The choice matters —each option leaves the number in a different state— and we'll tell you what it means as soon as the window closes.",
  whatsappModeCaveat: {
    standard:
      "You registered a new number on the WhatsApp API: it's now registered for the API and can no longer be used from the WhatsApp Business app.",
    coexistence:
      "You connected the number you already use in the WhatsApp Business app: it keeps working there and also reaches Resender. Meta decides eligibility, and the number gets a hard ceiling of 20 messages per second. The history has to be synced within the next 24 hours.",
  },
  connectedAccountsHeading: "CONNECTED ACCOUNTS",
  quota: "{activePageCount} of {maxPages} connections",
  quotaActiveSuffix: "active connections",
  quotaUnresolved: "quota unresolved · write to info@resender.dev",
  noticeConnectedGeneric: "Connected: the authorization completed.",
  noticeInstagramNamed:
    "Connected: the Instagram account @{username} is now authorized.",
  noticeInstagram: "Connected: the Instagram account is now authorized.",
  noticeConnectedOne: "Connected: 1 page authorized — {list}.",
  noticeConnectedMany: "Connected: {count} pages authorized — {list}.",
  listConjunction: "and",
  empty: {
    facebookTitle: "Facebook",
    facebookBody: "Authorize your pages from Meta to start receiving messages.",
    instagramTitle: "Instagram",
    instagramBody:
      "Authorize your professional account to receive direct messages and comments. You don't need a Facebook page.",
    whatsappTitle: "WhatsApp",
    whatsappBody:
      "Register a new number, or connect the one you already use in the WhatsApp Business App without giving it up on your phone. You can only reply within 24 hours of the customer's last message.",
    title: "No accounts connected yet.",
    body: "Once you authorize an account it shows up here, with its webhook and its status. Reconnecting refreshes the token and the metadata without duplicating accounts.",
    step1: "authorize the account",
    step2: "point your webhook",
    step3: "the first message arrives",
  },
}

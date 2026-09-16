export type WhatsappSignupDict = {
  connect: string
  connecting: string
  description: string
  preparing: string
  nonceFailed: string
  submitFailed: string
  networkFailed: string
  pairingIncomplete: string
  sdkBlocked: string
  popupClosed: string
  notConfigured: string
  pinLabel: string
  pinPlaceholder: string
  pinHint: string
}

export const es: WhatsappSignupDict = {
  connect: "Conectar WhatsApp",
  connecting: "Conectando…",
  description:
    "Meta abre su ventana y ahí eliges: dar de alta un número nuevo, o conectar el que ya usas en la app de WhatsApp Business. No da lo mismo cuál —cada opción deja el número de una manera distinta— y te contamos qué implica la que elijas en cuanto la ventana se cierre.",
  preparing: "Preparando la conexión con Meta…",
  nonceFailed:
    "No se pudo preparar la conexión con WhatsApp. Recarga la página e inténtalo de nuevo.",
  submitFailed:
    "No se pudo conectar. Vuelve a intentarlo; si se repite, escríbenos a info@resender.dev.",
  networkFailed:
    "No pudimos hablar con el servidor para terminar la conexión. Revisa tu conexión y vuelve a lanzarla.",
  pairingIncomplete:
    "La autorización de Meta volvió incompleta y no se conectó ningún número. Vuelve a lanzarla; si se repite, escríbenos a info@resender.dev.",
  sdkBlocked:
    "No se pudo cargar el SDK de Facebook, que es lo que abre la ventana de Meta. Suele ser un bloqueador de anuncios o de rastreadores: permítelo para este sitio y recarga la página.",
  popupClosed:
    "La ventana de Meta se cerró sin completar la autorización, así que no se conectó ningún número. Si no llegaste a verla, permite las ventanas emergentes para este sitio y vuelve a intentarlo.",
  notConfigured:
    "Conectar WhatsApp no está disponible en este despliegue: falta configurar NEXT_PUBLIC_WHATSAPP_CONFIG_ID. Escríbenos a info@resender.dev.",
  pinLabel: "PIN de verificación en dos pasos",
  pinPlaceholder: "6 dígitos",
  pinHint: "Escribe el PIN actual del número y vuelve a lanzar la conexión.",
}

export const en: WhatsappSignupDict = {
  connect: "Connect WhatsApp",
  connecting: "Connecting…",
  description:
    "Meta opens its window and you choose there: register a new number, or connect the one you already use in the WhatsApp Business app. The choice matters —each option leaves the number in a different state— and we'll tell you what it means as soon as the window closes.",
  preparing: "Preparing the connection with Meta…",
  nonceFailed:
    "We couldn't prepare the WhatsApp connection. Reload the page and try again.",
  submitFailed:
    "Couldn't connect. Please try again; if it keeps happening, write to info@resender.dev.",
  networkFailed:
    "We couldn't reach the server to finish the connection. Check your network and run it again.",
  pairingIncomplete:
    "Meta's authorization came back incomplete and no number was connected. Run it again; if it keeps happening, write to info@resender.dev.",
  sdkBlocked:
    "We couldn't load the Facebook SDK, which is what opens Meta's window. It's usually an ad or tracker blocker: allow it for this site and reload the page.",
  popupClosed:
    "Meta's window closed without completing the authorization, so no number was connected. If you never saw it, allow pop-ups for this site and try again.",
  notConfigured:
    "Connecting WhatsApp isn't available on this deployment: NEXT_PUBLIC_WHATSAPP_CONFIG_ID is missing. Write to info@resender.dev.",
  pinLabel: "Two-step verification PIN",
  pinPlaceholder: "6 digits",
  pinHint: "Type the number's current PIN and run the connection again.",
}

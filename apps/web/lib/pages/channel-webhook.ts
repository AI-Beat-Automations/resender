import { unsubscribeInstagramWebhook } from "@/lib/instagram"
import { unsubscribeFromWebhook } from "@/lib/meta"

import type { PageChannel } from "./page-registry"

// Despacho por canal de la desuscripción del webhook. Los dos endpoints se
// parecen pero no son intercambiables: Messenger va a
// `graph.facebook.com/{pageId}/subscribed_apps` con el page token, e Instagram a
// `graph.instagram.com/me/subscribed_apps` con el token de la cuenta y sin id en
// el path.
//
// Vive acá y no en el llamador porque son dos los que desuscriben —desconectar
// una cuenta y borrar el tenant— y los dos tienen que elegir igual. Mandar un
// token de Instagram al Graph de Facebook no da un error claro: da un 400 que
// se registra como «Meta no confirmó» y deja la cuenta recibiendo eventos.
export async function unsubscribeChannelWebhook(input: {
  channel: PageChannel
  metaPageId: string
  accessToken: string
}): Promise<boolean> {
  if (input.channel === "instagram") {
    return unsubscribeInstagramWebhook(input.accessToken)
  }
  return unsubscribeFromWebhook(input.metaPageId, input.accessToken)
}

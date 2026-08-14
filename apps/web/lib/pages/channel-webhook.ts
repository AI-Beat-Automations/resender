import { unsubscribeInstagramWebhook } from "@/lib/instagram"
import { unsubscribeFromWebhook } from "@/lib/meta"
import { log } from "@/lib/observability/logger"

import {
  countActiveWhatsappNumbersInWaba,
  type PageChannel,
} from "./page-registry"

// Despacho por canal de la desuscripción del webhook. Los tres endpoints se
// parecen pero no son intercambiables: Messenger va a
// `graph.facebook.com/{pageId}/subscribed_apps` con el page token, Instagram a
// `graph.instagram.com/me/subscribed_apps` con el token de la cuenta y sin id en
// el path, y WhatsApp a `graph.facebook.com/{wabaId}/subscribed_apps` — mismo
// host y misma forma que Messenger, pero con **otro id**.
//
// Vive acá y no en el llamador porque son dos los que desuscriben —desconectar
// una cuenta y borrar el tenant— y los dos tienen que elegir igual. Mandar un
// token de Instagram al Graph de Facebook no da un error claro: da un 400 que
// se registra como «Meta no confirmó» y deja la cuenta recibiendo eventos.
//
// WhatsApp repetía ese bug de la peor manera: como el despacho era un ternario
// binario, caía en la rama de Messenger y le pedía a Graph que desuscribiera el
// `phone_number_id` (que es lo que `meta_page_id` guarda en este canal). Ese id
// no es un nodo con `subscribed_apps`, así que la llamada falla, se registra
// como un fallo cualquiera y el número sigue recibiendo mensajes de un tenant
// que ya se dio de baja. Por eso el despacho es ahora un `switch` exhaustivo
// sobre `PageChannel`: el canal que se agregue mañana no tiene una rama por
// omisión donde caerse.
//
// ---------------------------------------------------------------------------
// WhatsApp: la unidad de conexión y la de suscripción no son la misma
// ---------------------------------------------------------------------------
//
// En Messenger y en Instagram lo que se conecta y lo que se suscribe son el
// mismo objeto: una página, una cuenta. En WhatsApp **se conecta un número y se
// suscribe la cuenta (el WABA)**, y un WABA puede tener varios números. Un
// `DELETE` por cada desconexión apagaba, sin ningún error visible, los webhooks
// de todos los demás números de esa cuenta: los del mismo tenant y los de
// cualquier otro que hubiera conectado un número del mismo WABA.
//
// De ahí la consulta de abajo: se desuscribe **solo cuando el número que se está
// dando de baja es el último activo del WABA**. La cuenta se hace sobre todos
// los tenants por el mismo motivo por el que existe el problema —el WABA es
// compartido y desuscribirlo los afecta a todos igual—.
//
// **La carrera de dos desconexiones simultáneas.** El orden de los llamadores es
// «primero marca la fila como `disconnected`, después pregunta», así que la
// cuenta siempre ve el efecto de la baja propia ya cometido. Con eso, dos bajas
// a la vez sobre el mismo WABA solo pueden terminar de dos maneras: la que
// commitea última ve cero y desuscribe (correcto), o las dos ven cero y
// desuscriben las dos (un `DELETE` de más sobre un nodo que ya quedó sin
// números, que Meta responde igual). Lo que **no** puede pasar es que ninguna
// desuscriba, que es la única de las tres que deja un WABA suscrito sin números
// activos, mandándonos eventos de un cliente que ya se fue. Errar hacia la
// llamada repetida y no hacia la llamada perdida es la decisión, y es la que
// hace que no haga falta un candado.
export async function unsubscribeChannelWebhook(input: {
  channel: PageChannel
  metaPageId: string
  accessToken: string
  // Solo WhatsApp lo usa, y para WhatsApp es obligatorio: es el nodo del que
  // cuelga la suscripción. Opcional en la firma porque los otros dos canales no
  // lo tienen y obligarlos a pasar `null` sería ruido en los dos llamadores.
  wabaId?: string | null
  // Las conexiones que la operación en curso está dando de baja y que, por
  // tanto, no cuentan como «todavía activas». Solo WhatsApp la mira.
  excludeConnectionIds?: string[]
}): Promise<boolean> {
  switch (input.channel) {
    case "instagram":
      return unsubscribeInstagramWebhook(input.accessToken)
    case "whatsapp": {
      if (!input.wabaId) {
        // Falla ruidoso y **sin llamar a nadie**. La alternativa —mandar el
        // `phone_number_id` por el camino de Messenger— es exactamente el bug
        // que este módulo existe para no repetir: haría una llamada que parece
        // intentada, que falla por el motivo equivocado y que deja al número
        // suscrito. Sin WABA no hay desuscripción posible, y decirlo es más
        // útil que fingirla.
        log({
          entrypoint: "action",
          action: "webhook_unsubscribe",
          outcome: "failed",
          reason: "missing_waba_id",
          channel: "whatsapp",
          accountId: input.metaPageId,
        })
        return false
      }

      const remaining = await countActiveWhatsappNumbersInWaba({
        wabaId: input.wabaId,
        excludeConnectionIds: input.excludeConnectionIds ?? [],
      })
      if (remaining > 0) {
        // No es un fallo: es la operación normal de un WABA con más de un
        // número. Se registra igual —como `skipped`, no como `ok`— porque la
        // pregunta «¿por qué este número dejó de estar conectado y su WABA
        // sigue mandando eventos?» tiene que poder contestarse desde el log.
        log({
          entrypoint: "action",
          action: "webhook_unsubscribe",
          outcome: "skipped",
          reason: "waba_has_active_numbers",
          channel: "whatsapp",
          accountId: input.wabaId,
          count: remaining,
        })
        return true
      }

      // Mismo endpoint que Messenger (`DELETE /{id}/subscribed_apps` en el
      // Graph de Facebook, que es donde vive Cloud API) con el id del WABA en
      // lugar del page id. Se reusa el cliente de `lib/meta` en vez de escribir
      // uno nuevo: es literalmente la misma llamada, y duplicarla solo por el
      // nombre del canal traería su propio manejo de errores que divergiría. El
      // canal sí viaja, para que el fallo no se registre como de Messenger.
      return unsubscribeFromWebhook(input.wabaId, input.accessToken, "whatsapp")
    }
    case "messenger":
      return unsubscribeFromWebhook(
        input.metaPageId,
        input.accessToken,
        "messenger"
      )
  }
}

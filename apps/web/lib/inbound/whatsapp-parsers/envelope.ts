import { asArray, asRecord, asString, asNumber, asTextId } from "./coerce"
import type { WhatsappError } from "./types"

// El sobre del webhook de WhatsApp **no** es `entry[].messaging[]` como
// Messenger e Instagram, sino `entry[].changes[].value`, y el mismo POST puede
// agregar hasta 1000 updates de campos distintos. Por eso todo se itera y nada
// asume `entry[0]`.

// Lo que trae un `changes[]` sin pedirle nada más: a qué cuenta pertenece, qué
// campo es y su `value`. Es el denominador común de **todos** los campos, y en
// particular de los de ámbito WABA —los tres de plantilla (ADR 0014) y
// `account_update`—, cuyo `value` no trae `metadata` y por tanto tampoco
// `phone_number_id`: la plantilla vive en la cuenta y no en el número.
export type WhatsappAccountChange = {
  wabaId: string | null
  field: string
  value: Record<string, unknown>
}

// Un cambio de ámbito **número**. Los cuatro campos de mensajería (`messages`,
// `history`, `smb_app_state_sync`, `smb_message_echoes`) sí traen
// `metadata.phone_number_id`, que es con lo que se resuelve la cuenta
// conectada. Los parsers de mensajería piden este tipo y no el de arriba, así
// que el compilador es el que impide que a uno de ellos le llegue un cambio sin
// número —no hace falta que cada uno lo compruebe otra vez—.
export type WhatsappChange = WhatsappAccountChange & {
  providerPhoneNumberId: string
  // `metadata.display_phone_number`, el número del negocio. Solo se usa para
  // deducir la dirección de los mensajes del historial que llegan sin hilo.
  businessPhoneNumber: string | null
}

export function collectChanges(body: unknown): WhatsappAccountChange[] {
  const root = asRecord(body)
  if (!root) return []

  const changes: WhatsappAccountChange[] = []
  for (const rawEntry of asArray(root.entry)) {
    const entry = asRecord(rawEntry)
    // Un `entry` que no tiene forma de objeto no lleva `changes` que recorrer:
    // eso sí es basura y se descarta. **La falta de `entry.id` no lo es.** Para
    // la mensajería el WABA no enruta nada —de eso se encarga
    // `metadata.phone_number_id`—, así que tirar el `entry` entero por él
    // significaría perder todos sus mensajes reales, sin un solo log, por un
    // campo que ahí es decorativo. Basta con que llegue en null.
    //
    // Para los eventos de plantilla, en cambio, el WABA **sí** es esencial: es
    // un tercio de la clave del espejo (ADR 0014). Ese descarte lo hace su
    // parser, evento a evento, y no el sobre: exigirlo aquí castigaría a los
    // mensajes por una carencia que solo le importa a las plantillas.
    //
    // Por eso se lee con `asTextId` y no con `asString`: Meta documenta `id`
    // como string y lo manda como **número** JSON, así que `asString` lo dejaba
    // en null *siempre*. Mientras el WABA era decorativo eso no molestaba a
    // nadie; desde que llavea el espejo, descartaba todos los eventos de
    // plantilla en silencio —el `field` matchea, así que ni siquiera caían en
    // `unhandledFields`—.
    if (!entry) continue
    const wabaId = asTextId(entry.id)

    for (const rawChange of asArray(entry.changes)) {
      const change = asRecord(rawChange)
      // `field` no se adivina a partir de la forma del `value` aunque falte.
      // `messages[]` significa "mensaje entrante" bajo `field: "messages"` y
      // "ID de media del historial" bajo `field: "history"`, y confundirlos
      // haría que un mensaje de hace seis meses abriera la ventana de 24 h y se
      // reenviara al webhook del tenant como si acabara de llegar. Descartar es
      // peor que acertar, pero mucho mejor que equivocarse callado.
      const field = asString(change?.field)
      const value = asRecord(change?.value)
      if (!field || !value) continue

      changes.push({ wabaId, field, value })
    }
  }

  return changes
}

// Sin `phone_number_id` no hay número conectado al que atribuir el evento, y
// por tanto tampoco tenant: un campo de mensajería así no tiene nada que hacer.
//
// El descarte estaba antes dentro de `collectChanges`, y desde que hay campos
// de ámbito WABA eso era un error: borraba del lote —y de `unhandledFields`—
// todo evento de plantilla y todo `account_update` antes de que nadie los
// viera, que es exactamente el «desaparecer en silencio» que este directorio
// dice no querer. Ahora la exigencia la pone el enrutador en los cuatro casos
// que sí la tienen, y quien no la tiene no la paga.
export function withPhoneNumber(
  change: WhatsappAccountChange
): WhatsappChange | null {
  const metadata = asRecord(change.value.metadata)
  const providerPhoneNumberId = asString(metadata?.phone_number_id)
  if (!providerPhoneNumberId) return null

  return {
    ...change,
    providerPhoneNumberId,
    businessPhoneNumber: asString(metadata?.display_phone_number),
  }
}

// El mismo aplanado sirve para los errores de un mensaje `unsupported`, los de
// un status `failed` y los de un chunk de historial rechazado: Meta usa la
// misma forma en los tres sitios.
export function readErrors(value: unknown): WhatsappError[] {
  return asArray(value).flatMap((raw) => {
    const error = asRecord(raw)
    if (!error) return []
    return [
      {
        code: asNumber(error.code),
        title: asString(error.title),
        message: asString(error.message),
        details: asString(asRecord(error.error_data)?.details),
      },
    ]
  })
}

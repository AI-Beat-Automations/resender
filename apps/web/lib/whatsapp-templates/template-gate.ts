import type {
  WhatsappTemplateRecord,
  WhatsappTemplateStatus,
} from "./template-registry"

// El gate del espejo de plantillas: la última decisión antes de llamar a Cloud
// API con `type: "template"`.
//
// **Este gate falla abierto, y es a propósito.** Todo otro gate del envío
// —permiso de canal, waitlist, suscripción, cuota— falla cerrado, porque ahí la
// ausencia de dato significa «no tiene derecho». Acá significa otra cosa: el
// espejo es una copia de un catálogo del que Meta es dueño (ADR 0014), y un
// hueco es un estado legítimo y frecuente —una plantilla creada en WhatsApp
// Manager después del último sync, o creada mientras el job paginaba—. Rechazar
// por ese hueco sería negarle al cliente un envío perfectamente válido por una
// carencia nuestra, y encima uno que no puede arreglar: no tiene forma de
// pedirnos que resincronicemos.
//
// Por eso la regla es asimétrica y sólo suena parecida a un fail-closed:
//
//   - fila presente y `APPROVED`      → se envía;
//   - fila presente en otro estado    → se rechaza **sin llamar a Meta**;
//   - fila ausente                    → se envía, y decide Meta.
//
// La segunda rama no contradice a la tercera: lo que ahí tenemos no es un hueco
// sino una afirmación de Meta —«esta plantilla no está aprobada»— y ahorrarnos
// la llamada convierte un 132001 remoto y tardío en un 409 nuestro inmediato
// que nombra el estado.
//
// Si alguna vez esto parece un bug y la tentación es «arreglar» el fail-open
// haciendo que la fila ausente rechace: eso rompe el caso 13 del issue #79 y
// convierte cada retraso de nuestro sync en un envío perdido del cliente. La
// autoridad sobre qué plantillas existen es de Meta y nunca fue nuestra.
//
// Puro por la misma razón que `isWindowOpen`: recibe el registro ya leído, no
// lo busca. Sin base, sin red y sin mocks, así que su test puede ser exhaustivo
// sobre lo único que importa acá, que es la decisión.

// Lo mínimo que el gate necesita del espejo. Un `Pick` y no el registro entero
// para que quede escrito que la decisión no mira ni el dueño, ni el hsm id, ni
// la antigüedad del sync: sólo el estado.
export type MirroredTemplate = Pick<
  WhatsappTemplateRecord,
  "name" | "language" | "status" | "rawStatus"
>

export type WhatsappTemplateGateDecision =
  | { allowed: true }
  | {
      allowed: false
      // Normalizado y crudo, los dos: el primero es con el que se decidió, el
      // segundo es lo que Meta dijo de verdad. Con un estado nuevo el primero
      // es `unknown` y el segundo es la única pista útil para el cliente.
      status: WhatsappTemplateStatus
      rawStatus: string
      message: string
    }

// Qué hacer con cada estado, que es el punto entero de nombrarlo: «pausada por
// calidad» y «rechazada» llevan a acciones opuestas y un mensaje único las
// aplanaría a «no se puede enviar».
//
// `APPROVED` está excluido del `Record` a propósito: es el único estado que no
// produce mensaje, y dejarlo fuera hace que agregar un estado al catálogo del
// registro **no compile** hasta que alguien decida qué se le dice al cliente.
const STATUS_GUIDANCE: Record<
  Exclude<WhatsappTemplateStatus, "APPROVED">,
  string
> = {
  PENDING:
    "It is still under review by WhatsApp; this usually takes up to 24 hours.",
  IN_REVIEW:
    "It is still under review by WhatsApp; this usually takes up to 24 hours.",
  IN_APPEAL: "An appeal is open for it and WhatsApp has not decided yet.",
  REJECTED:
    "WhatsApp rejected it. Edit it and submit it again, or appeal from WhatsApp Manager.",
  PAUSED:
    "WhatsApp paused it after negative feedback from recipients. It becomes sendable again on its own once the pause ends.",
  DISABLED:
    "WhatsApp disabled it after repeated negative feedback. It will not become sendable again: create a new template.",
  PENDING_DELETION: "It is scheduled for deletion and can no longer be sent.",
  LIMIT_EXCEEDED:
    "The WhatsApp Business Account reached its template limit, so this template cannot be sent.",
  unknown:
    "WhatsApp reports a status Resender does not recognise, so the template is not known to be approved. Check it in WhatsApp Manager.",
}

/**
 * Si el espejo permite intentar el envío de esta plantilla.
 *
 * `null` es «no está en el espejo» y **permite**. Ver el comentario de cabecera
 * antes de cambiarlo: es la decisión, no un descuido.
 */
export function decideWhatsappTemplateSend(
  mirrored: MirroredTemplate | null
): WhatsappTemplateGateDecision {
  if (!mirrored) return { allowed: true }
  if (mirrored.status === "APPROVED") return { allowed: true }

  return {
    allowed: false,
    status: mirrored.status,
    rawStatus: mirrored.rawStatus,
    // El estado va en el mensaje además de en su campo: es lo primero que
    // aparece en un log de cliente y lo que separa este 409 de un rechazo del
    // destinatario.
    message: `WhatsApp template "${mirrored.name}" (${mirrored.language}) is not approved: its status is ${mirrored.rawStatus}. ${STATUS_GUIDANCE[mirrored.status]}`,
  }
}

import type { WhatsappTemplateStatus } from "./template-store"

// El control «no aprobada» del envío de plantillas (issue #193). Módulo puro:
// recibe lo que la copia local sabe de la plantilla y decide si se llama a
// Meta.
//
// **Falla abierto.** La copia no es la fuente de verdad —lo es Meta— y un hueco
// en ella es un estado válido: una plantilla recién creada en WhatsApp Manager
// que todavía no pasó por el sync ni por el webhook. Solo se rechaza lo que la
// copia **sabe** que no está aprobado:
//
// - fila ausente → se envía, y decide Meta;
// - fila `APPROVED` → se envía;
// - fila con cualquier otro estado, incluido `unknown` → 409 sin llamar a Meta.
//
// `unknown` rechaza porque es un estado que Meta sí mandó y no reconocemos, no
// la falta de dato: la plantilla existe y no está aprobada.

export type TemplateSendGateDecision =
  | { ok: true }
  | { ok: false; status: WhatsappTemplateStatus }

export function decideTemplateSend(
  template: { status: WhatsappTemplateStatus } | null
): TemplateSendGateDecision {
  if (!template) return { ok: true }
  if (template.status === "APPROVED") return { ok: true }
  return { ok: false, status: template.status }
}

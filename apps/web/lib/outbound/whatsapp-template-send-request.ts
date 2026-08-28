import type { WhatsappOutboundTemplate } from "@/lib/outbound/whatsapp-send"

// El body de `POST /api/meta/whatsapp/templates/send`, y **sólo** el de esa
// ruta.
//
// Existe como parser aparte y no como una tercera rama de
// `parseOutboundSendInput` porque aquel es **neutral de canal**: lo comparten
// Messenger, Instagram y WhatsApp, y ninguno de los dos primeros puede enviar
// una [Plantilla]. Meterle un XOR de tres ramas a un módulo que dos canales no
// pueden usar es costo permanente para los tres a cambio de ahorrar una ruta
// (ADR 0014). El destino —`pageId`, `recipientId`, `conversationId`— se repite
// campo por campo, y esa repetición es el precio elegido: son ~20 líneas contra
// un tipo compartido que ninguno de los dos podría leer sin estrecharlo.
//
// **Los `components` no se validan.** Se comprueba que sea una lista y nada
// más: ni el conteo de parámetros, ni el tipo de cada componente, ni que
// coincidan con el cuerpo de la plantilla. Es la misma decisión que hace que el
// gate del espejo falle abierto y por el mismo motivo: el conteo es lo que más
// fácil se desactualiza —una edición cambia las variables y el webhook de
// estado no trae contenido— y **un falso rechazo nuestro es peor que uno de
// Meta**, porque contra el de Meta el cliente puede corregir el envío y contra
// el nuestro no puede hacer nada. Meta valida esto en el mismo request; que lo
// haga quien es dueño de la plantilla.
//
// Por lo mismo tampoco se valida la forma de `name` ni de `language`: que el
// nombre sea minúscula con guiones bajos, o que el idioma sea un código que
// Meta reconozca, son reglas de Meta y cambian sin avisarnos. Acá sólo se
// exige que estén y no vengan vacíos, que es lo único que podemos afirmar sin
// riesgo de negar un envío legítimo.
//
// **Sin errores diferidos**, a diferencia del parser neutral. Allá el `code`
// existe para poder contestar el 409 de ventana cerrada antes que un 400 de
// contenido; acá la ventana no se aplica —es justo lo que la plantilla existe
// para saltar— así que no hay ningún gate posterior cuya causa le gane a ésta y
// el rechazo sale en el momento. Los códigos siguen siendo estables porque la
// ruta es nueva y un cliente que la integra merece distinguir «te falta el
// idioma» de «te falta el destinatario» sin parsear texto.

export type WhatsappTemplateSendErrorCode =
  | "body_invalid"
  | "page_id_missing"
  | "recipient_id_missing"
  | "conversation_id_invalid"
  | "template_missing"
  | "template_name_missing"
  | "template_language_missing"
  | "template_components_invalid"

export type WhatsappTemplateSendInput = {
  pageId: string
  recipientId: string
  conversationId?: string
  // La misma forma que consume el adaptador de salida, importada y no
  // redeclarada: el contrato público y el de Meta coinciden campo por campo
  // —nombre e idioma es lo único que Cloud API acepta al enviar— y tener dos
  // definiciones de lo mismo sólo daría lugar a que una se quede atrás.
  template: WhatsappOutboundTemplate
}

export type WhatsappTemplateSendInputResult =
  | { ok: true; value: WhatsappTemplateSendInput }
  | { ok: false; code: WhatsappTemplateSendErrorCode; error: string }

/**
 * Valida y normaliza el body del envío de plantilla.
 *
 * Puro: sin base, sin red y sin reloj. Todo lo que decide se decide con lo que
 * vino en el request.
 */
export function parseWhatsappTemplateSendInput(
  body: unknown
): WhatsappTemplateSendInputResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "body_invalid", error: "invalid body" }
  }

  const { pageId, recipientId, conversationId, template } = body as Record<
    string,
    unknown
  >

  // Los textos de los tres campos de destino son **los mismos** que devuelve el
  // parser neutral, a propósito: quien ya integra `/whatsapp/send` no tiene que
  // aprender un segundo vocabulario para el mismo error. Lo que se agrega es el
  // `code`, que allá no existe para estos campos por compatibilidad con
  // clientes viejos y acá no tiene ese problema.
  if (typeof pageId !== "string" || pageId.trim().length === 0) {
    return { ok: false, code: "page_id_missing", error: "missing pageId" }
  }
  if (typeof recipientId !== "string" || recipientId.trim().length === 0) {
    return {
      ok: false,
      code: "recipient_id_missing",
      error: "missing recipientId",
    }
  }
  if (
    conversationId !== undefined &&
    (typeof conversationId !== "string" || conversationId.trim().length === 0)
  ) {
    return {
      ok: false,
      code: "conversation_id_invalid",
      error: "invalid conversationId",
    }
  }

  if (!template || typeof template !== "object" || Array.isArray(template)) {
    return {
      ok: false,
      code: "template_missing",
      error: "missing template: send an object with name and language",
    }
  }

  const { name, language, components } = template as Record<string, unknown>

  if (typeof name !== "string" || name.trim().length === 0) {
    return {
      ok: false,
      code: "template_name_missing",
      error: "missing template.name",
    }
  }

  // Idioma obligatorio y sin default. La identidad de una [Plantilla] es el par
  // `(nombre, idioma)` y no el nombre: adivinar un `es` porque el tenant es
  // hispanohablante mandaría una plantilla distinta de la que pidió, o ninguna.
  if (typeof language !== "string" || language.trim().length === 0) {
    return {
      ok: false,
      code: "template_language_missing",
      error: "missing template.language",
    }
  }

  const hasComponents = components !== undefined && components !== null
  if (hasComponents && !Array.isArray(components)) {
    return {
      ok: false,
      code: "template_components_invalid",
      error: "template.components must be an array",
    }
  }

  return {
    ok: true,
    value: {
      pageId: pageId.trim(),
      recipientId: recipientId.trim(),
      conversationId: conversationId?.trim(),
      template: {
        name: name.trim(),
        // Sin `toLowerCase()` ni normalización de `es_AR` a `es`: el código de
        // idioma va tal cual porque `es` y `es_AR` son dos plantillas distintas
        // en la WABA y "arreglar" el que mandó el cliente elegiría por él.
        language: language.trim(),
        // Una lista vacía se trata como ausencia y no se reenvía: una plantilla
        // sin variables no lleva el campo, y mandarlo vacío es pedirle a Meta
        // que interprete una lista que no existe. Es lo único que este parser
        // decide sobre `components`; su contenido pasa derecho y sin mirar.
        ...(Array.isArray(components) && components.length > 0
          ? { components }
          : {}),
      },
    },
  }
}

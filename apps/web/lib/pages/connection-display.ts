import type { PageChannel } from "./page-registry"

// Cómo se presenta una conexión en la tarjeta de /connections, y cómo se nombra
// cada canal en el resto del producto (el badge del log de Inbox usa el mismo
// `CHANNEL_LABEL`: dos catálogos de nombres se desincronizan solos).
//
// Módulo puro —sin React, sin Next, sin DB— y no un puñado de ternarios dentro
// de los `.tsx`: los tests de esta app no corren componentes, así que una regla
// escrita ahí dentro sería una regla sin red. Es además el motivo por el que
// todo lo de acá es `Record<PageChannel, …>` y no `channel === "instagram" ? …`:
// con el ternario, el cuarto canal cae en la rama `else` —Messenger— sin que
// nada falle; con el `Record`, TypeScript no compila hasta que alguien decida
// qué dice el canal nuevo.

export const CHANNEL_LABEL: Record<PageChannel, string> = {
  messenger: "Messenger",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
}

/**
 * El sustantivo con el que cada canal se nombra en el copy. Lo que se conecta
 * no es lo mismo en los tres —una Página, una cuenta profesional, un número—, y
 * «reconecta esta página» sobre un número de WhatsApp manda al usuario a buscar
 * una Página de Facebook que no existe.
 */
export const CHANNEL_NOUN: Record<PageChannel, string> = {
  messenger: "esta página",
  instagram: "esta cuenta",
  whatsapp: "este número",
}

/**
 * Qué hacer cuando Meta rechaza el token, canal por canal. No es la misma
 * acción en los tres: en Messenger se renuevan permisos desde Facebook, en
 * Instagram el token vence a los ~60 días y se vuelve a autorizar, y en WhatsApp
 * hay que rehacer el Embedded Signup. Un texto genérico manda al usuario a la
 * pantalla equivocada.
 */
export const TOKEN_INVALID_BODY: Record<PageChannel, string> = {
  messenger:
    "Meta rechazó el token de la página. Reconéctala desde Facebook para renovar permisos antes de volver a enviar respuestas.",
  instagram:
    "Meta rechazó el token de la cuenta. Vuelve a autorizarla en Instagram para renovarlo antes de seguir enviando respuestas.",
  whatsapp:
    "Meta rechazó el token del número. Vuelve a lanzar el Embedded Signup para renovarlo: mientras tanto no entra ni sale nada por este número.",
}

/** El diálogo de Meta que reconecta cada canal. */
export const CHANNEL_RECONNECT_HREF: Record<PageChannel, string> = {
  messenger: "/api/meta/start",
  instagram: "/api/meta/instagram/start",
  whatsapp: "/api/meta/whatsapp/start",
}

// Los dos flujos de alta de WhatsApp (PRD, §A y §B). No son dos variantes del
// mismo botón: el estándar registra el número con `/register` y el de
// Coexistence no lo toca nunca, así que el modo se persiste y la tarjeta lo
// dice —es lo que explica por qué este número tiene techo de 20 mps y aquel no.
export type WhatsappOnboardingMode = "standard" | "coexistence"

export const ONBOARDING_MODE_LABEL: Record<WhatsappOnboardingMode, string> = {
  standard: "número nuevo (estándar)",
  coexistence: "número existente (Coexistence)",
}

/**
 * A dónde va «Reconectar». En WhatsApp llevó un `?mode=coexistence` mientras el
 * launcher tuvo dos botones y había que resaltar el correcto. Ya no: Meta ofrece
 * los dos flujos dentro del mismo diálogo, el usuario elige ahí y el modo lo
 * deriva el evento de cierre. Un `?mode=` en el enlace prometería decidir algo
 * que se decide adentro.
 */
export function resolveReconnectHref(page: { channel: PageChannel }): string {
  return CHANNEL_RECONNECT_HREF[page.channel]
}

export type ConnectionIdentity = {
  /** Titular de la tarjeta: lo que el usuario reconoce de un vistazo. */
  title: string
  /** Renglón mono de abajo: los ids que cita en un correo de soporte. */
  identity: string
}

export type ConnectionIdentityInput = {
  channel: PageChannel
  name: string
  username: string | null
  metaPageId: string
  wabaId: string | null
  whatsappPhoneE164: string | null
}

/**
 * Quién es esta conexión, canal por canal.
 *
 * En WhatsApp el titular es **el número**, no el `name`: `meta_page_id` guarda
 * el `phone_number_id`, que es un entero opaco que no dice ni qué número es ni a
 * qué WABA pertenece (migración 0017). El WABA queda de secundario junto al
 * `phone_number_id` porque es el id que hay que citar cuando algo falla del lado
 * de Meta, y porque un WABA puede tener varios números: sin él, dos tarjetas del
 * mismo negocio son indistinguibles.
 *
 * Las caídas son deliberadas: un número sin `whatsapp_phone_e164` todavía se
 * identifica por su nombre, y un WABA ausente se dice —`waba_id —`— en vez de
 * desaparecer del renglón, que es lo que haría creer que el dato no existe.
 */
export function formatConnectionIdentity(
  page: ConnectionIdentityInput
): ConnectionIdentity {
  switch (page.channel) {
    case "instagram":
      return {
        title: page.name,
        // El @handle es lo que el usuario reconoce; el IG ID no le dice nada,
        // pero es lo que cita en soporte.
        identity: page.username
          ? `@${page.username} · ig_id ${page.metaPageId}`
          : `page_id ${page.metaPageId}`,
      }
    case "whatsapp":
      return {
        title: page.whatsappPhoneE164 ?? page.name,
        identity: `waba_id ${page.wabaId ?? "—"} · phone_number_id ${page.metaPageId}`,
      }
    case "messenger":
      return { title: page.name, identity: `page_id ${page.metaPageId}` }
  }
}

// Estado del import de historial de Coexistence (`history_sync_status`, 0017).
// El catálogo entero, incluido `not_requested`, que es donde nace la conexión.
export type HistorySyncStatus =
  | "not_requested"
  | "requested"
  | "in_progress"
  | "complete"
  | "failed"
  | "expired"

export type HistorySyncNotice = {
  label: string
  tone: "info" | "success" | "warning" | "danger"
  body: string
  /**
   * Acción concreta. Solo la traen `failed` y `expired`: son los dos estados
   * donde el historial **no va a llegar solo** y alguien tiene que hacer algo.
   * En los otros cuatro un botón sería ruido —o peor, invitaría a rehacer una
   * conexión que está avanzando bien—.
   */
  actionLabel: string | null
}

/**
 * Qué dice la tarjeta en cada estado del sync.
 *
 * El eje que ordena todo esto es el **deadline duro de 24 h** del PRD: si el
 * historial no terminó de sincronizarse dentro de esa ventana, Meta da de baja
 * el onboarding y no hay reintento posible, solo rehacerlo. Por eso `expired` no
 * ofrece «reintentar» —no hay nada que reintentar— y lo dice con las palabras
 * exactas del plazo: un «error al sincronizar» genérico dejaría al usuario
 * esperando un reintento que nunca llega.
 *
 * `complete` con cero mensajes es un caso válido y no un fallo: el negocio elige
 * si comparte su historial, y «cero webhooks» es una de las respuestas
 * legítimas. El copy no promete mensajes, dice que el import terminó.
 */
export const HISTORY_SYNC_NOTICE: Record<HistorySyncStatus, HistorySyncNotice> =
  {
    not_requested: {
      label: "historial: sin pedir",
      tone: "info",
      body: "Todavía no pedimos el historial a Meta. El plazo de 24 horas desde la conexión ya corre: si se agota sin sincronizar, hay que rehacer la conexión.",
      actionLabel: null,
    },
    requested: {
      label: "historial: pedido",
      tone: "info",
      body: "Le pedimos el historial a Meta y estamos esperando el primer bloque. No hace falta que hagas nada.",
      actionLabel: null,
    },
    in_progress: {
      label: "historial: importando",
      tone: "info",
      body: "El historial está llegando por bloques. Las conversaciones aparecen en el Inbox a medida que se importan.",
      actionLabel: null,
    },
    complete: {
      label: "historial: completo",
      tone: "success",
      body: "El import terminó. Si el negocio eligió no compartir su historial, es normal que no haya aparecido ninguna conversación vieja.",
      actionLabel: null,
    },
    failed: {
      label: "historial: falló",
      tone: "warning",
      body: "No pudimos importar el historial: agotamos los reintentos contra Meta. Vuelve a lanzar el alta de Coexistence para pedirlo otra vez, mientras el plazo de 24 horas siga abierto.",
      actionLabel: "Rehacer el alta de Coexistence",
    },
    expired: {
      label: "historial: vencido",
      tone: "danger",
      // Las palabras del PRD, literales: pasó el plazo de 24 horas y la
      // conexión hay que rehacerla desde el Embedded Signup. No hay reintento.
      body: "Pasó el plazo de 24 horas y la conexión hay que rehacerla desde el Embedded Signup. Meta da de baja el onboarding cuando el historial no se sincroniza dentro de esa ventana, y no existe forma de reanudarlo.",
      actionLabel: "Rehacer desde el Embedded Signup",
    },
  }

/**
 * El aviso que le toca a esta conexión, o `null` si no le toca ninguno.
 *
 * Solo WhatsApp tiene historial que importar, y solo en Coexistence: el flujo
 * estándar es un número nuevo, no hay conversaciones previas que traer. Una fila
 * de Messenger con `history_sync_status` poblado sería un dato imposible, y el
 * guard por canal evita que un backfill raro dibuje una sección que no aplica.
 */
export function resolveHistorySyncNotice(page: {
  channel: PageChannel
  historySyncStatus: HistorySyncStatus | null
}): HistorySyncNotice | null {
  if (page.channel !== "whatsapp") return null
  if (!page.historySyncStatus) return null
  return HISTORY_SYNC_NOTICE[page.historySyncStatus]
}

/**
 * Los dos límites de Coexistence que hay que decir **antes** de venderlo (PRD,
 * §Riesgos). Los dos son de Meta y ninguno se negocia desde acá, así que la
 * tarjeta los declara en lugar de dejar que el cliente los descubra el día que
 * su campaña se encola o que su número resulta inelegible.
 */
export const COEXISTENCE_LIMITS: readonly string[] = [
  "Techo fijo de 20 mensajes por segundo: un número en Coexistence no escala por messaging tier, por más volumen que tenga la cuenta.",
  "La elegibilidad la decide Meta: el país, el número, la cuenta, la versión de WhatsApp Business App o el dispositivo pueden dejarlo fuera, y no hay lista publicada.",
]

/** Si la tarjeta tiene que explicar las limitaciones de Coexistence. */
export function showsCoexistenceLimits(page: {
  channel: PageChannel
  onboardingMode: WhatsappOnboardingMode | null
}): boolean {
  return page.channel === "whatsapp" && page.onboardingMode === "coexistence"
}

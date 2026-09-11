import type { AppDict } from "@/content/i18n/app"

import type { PageChannel } from "./page-registry"

// Cómo se presenta una conexión en la tarjeta de /connections: qué diálogo la
// reconecta, cómo se identifica, y qué avisos le tocan.
//
// Módulo puro —sin React, sin Next, sin DB— y no un puñado de ternarios dentro
// de los `.tsx`: los tests de esta app no corren componentes, así que una regla
// escrita ahí dentro sería una regla sin red. Es además el motivo por el que
// todo lo de acá es `Record<PageChannel, …>` y no `channel === "instagram" ? …`:
// con el ternario, el cuarto canal cae en la rama `else` —Messenger— sin que
// nada falle; con el `Record`, TypeScript no compila hasta que alguien decida
// qué dice el canal nuevo.

// `CHANNEL_LABEL`, `CHANNEL_NOUN` y `TOKEN_INVALID_BODY` vivían acá como
// `Record<PageChannel, string>`. Hoy son `t.channels.label`, `t.channels.noun` y
// `t.channels.tokenInvalidBody` en `content/i18n/app`, que son el mismo `Record`
// exhaustivo —el canal nuevo tampoco compila hasta que alguien decida cómo se
// dice— solo que ahora en los dos idiomas. Lo que queda en este módulo es lo que
// NO es copy: rutas, identidad y reglas.

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

export type HistorySyncTone = "info" | "success" | "warning" | "danger"

export type HistorySyncNotice = {
  label: string
  tone: HistorySyncTone
  body: string
  /**
   * Acción concreta. Solo la traen `failed` y `expired`: son los dos estados
   * donde el historial **no va a llegar solo** y alguien tiene que hacer algo.
   * En los otros cuatro un botón sería ruido —o peor, invitaría a rehacer una
   * conexión que está avanzando bien—.
   *
   * Que sean esos dos y no otros es una regla del dominio, no del idioma: la
   * fija el diccionario poniendo `actionLabel: null` en los cuatro restantes, y
   * el test lo comprueba sobre el `Record` entero.
   */
  actionLabel: string | null
}

/**
 * El tono de cada estado. Se queda en el módulo y no en el diccionario porque
 * no es copy: es una decisión de diseño —qué se pinta de rojo— que tiene que ser
 * la misma en los dos idiomas, y que un traductor no debería poder cambiar.
 *
 * El eje que ordena todo esto es el **deadline duro de 24 h** del PRD: si el
 * historial no terminó de sincronizarse dentro de esa ventana, Meta da de baja
 * el onboarding y no hay reintento posible, solo rehacerlo. Por eso `expired` va
 * en `danger` y no ofrece «reintentar»: no hay nada que reintentar.
 *
 * `complete` con cero mensajes es un caso válido y no un fallo: el negocio elige
 * si comparte su historial, y «cero webhooks» es una de las respuestas
 * legítimas. El copy no promete mensajes, dice que el import terminó.
 */
export const HISTORY_SYNC_TONE: Record<HistorySyncStatus, HistorySyncTone> = {
  not_requested: "info",
  requested: "info",
  in_progress: "info",
  complete: "success",
  failed: "warning",
  expired: "danger",
}

/**
 * El aviso que le toca a esta conexión, o `null` si no le toca ninguno.
 *
 * Solo WhatsApp tiene historial que importar, y solo en Coexistence: el flujo
 * estándar es un número nuevo, no hay conversaciones previas que traer. Una fila
 * de Messenger con `history_sync_status` poblado sería un dato imposible, y el
 * guard por canal evita que un backfill raro dibuje una sección que no aplica.
 */
export function resolveHistorySyncNotice(
  page: {
    channel: PageChannel
    historySyncStatus: HistorySyncStatus | null
  },
  t: AppDict
): HistorySyncNotice | null {
  if (page.channel !== "whatsapp") return null
  if (!page.historySyncStatus) return null
  const copy = t.channels.historySync[page.historySyncStatus]
  return { ...copy, tone: HISTORY_SYNC_TONE[page.historySyncStatus] }
}

/**
 * Si la tarjeta tiene que explicar las limitaciones de Coexistence.
 *
 * Los dos límites que hay que decir **antes** de venderlo (PRD, §Riesgos) viven
 * en `t.channels.coexistenceLimits`. Los dos son de Meta y ninguno se negocia
 * desde acá, así que la tarjeta los declara en lugar de dejar que el cliente los
 * descubra el día que su campaña se encola o que su número resulta inelegible;
 * lo que se queda en este módulo es la regla de cuándo se dicen.
 */
export function showsCoexistenceLimits(page: {
  channel: PageChannel
  onboardingMode: WhatsappOnboardingMode | null
}): boolean {
  return page.channel === "whatsapp" && page.onboardingMode === "coexistence"
}

/**
 * Si la tarjeta ofrece revelar el PIN de verificación en dos pasos.
 *
 * Solo cuando el PIN lo **generamos nosotros** (`whatsapp_pin_generated`). Es la
 * distinción que la migración `0017` justifica: registrar un número que no tenía
 * 2FA se la activa con un PIN que Meta no vuelve a mostrar y que no tiene
 * endpoint de lectura, así que somos los únicos que lo sabemos y estamos
 * obligados a poder devolvérselo. Un PIN que escribió el cliente ya lo conoce, y
 * enseñárselo sería ruido que además invita a preguntarse por qué lo tenemos.
 *
 * Hace falta de verdad, no es una comodidad: sin esto, reconectar el mismo
 * número en otro entorno —o después de restaurar— falla con un `133005` pidiendo
 * un PIN que inventamos y que nadie puede recuperar.
 *
 * El botón se ofrece aunque la conexión esté desconectada: el PIN sigue vivo del
 * lado de Meta, y justamente cuando la conexión ya no está es cuando hace falta
 * recuperarlo.
 */
export function offersPinReveal(page: {
  channel: PageChannel
  whatsappPinGenerated: boolean
}): boolean {
  return page.channel === "whatsapp" && page.whatsappPinGenerated
}

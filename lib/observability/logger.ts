import type { PageChannel } from "@/lib/pages/page-registry"

import type { LogAction, LogEntrypoint, LogOutcome, LogReason } from "./catalog"

// El catálogo cerrado (verbos, resultados y motivos) vive en `./catalog` para
// leerse solo. Se re-exporta para que todo siga importándolo desde acá.
export type { LogAction, LogEntrypoint, LogOutcome, LogReason } from "./catalog"

// Log estructurado del worker `web`. Siempre **un solo objeto** y nunca un
// string interpolado ni dos argumentos: Workers Logs indexa las claves del
// objeto y las vuelve filtrables (`$.accountId = "..."`); un mensaje
// concatenado solo se puede buscar por texto, y buscar por texto es
// exactamente lo que hoy no alcanza.
//
// La regla que ordena el módulo entero: **ningún camino puede terminar en
// silencio**. Los tres modos de falla más caros del proyecto —la app de Meta en
// modo desarrollo, el `INSTAGRAM_APP_SECRET` equivocado, y un parser que dejaba
// de reconocer el payload— se manifestaron los tres igual: no llegaba nada y no
// había un solo error que mirar. Por eso `reason` es **obligatorio en el tipo**
// cuando el resultado no es `ok`: un descarte sin motivo no compila.

type LogLevel = "info" | "warn" | "error"

// **La redacción es el tipo.** No hay campo para el texto del mensaje, ni para
// el body de Meta, ni para un token, ni para la firma, y no hay ningún campo de
// tipo `unknown` ni `Record<string, unknown>` por el cual pudieran entrar. El
// contenido del usuario se resume en `textLength`, que sirve para distinguir
// «llegó vacío» de «llegó» sin guardar lo que dijo nadie.
type AccountFields = {
  tenantId?: string
  connectionId?: string
  channel?: PageChannel
  accountId?: string
  accountHandle?: string
  // Cuántas conexiones activas siguen colgando del mismo nodo de Meta. Solo lo
  // escribe la baja de WhatsApp, y es la que contesta «¿por qué este número se
  // desconectó y su WABA sigue mandando eventos?». Es un conteo, no contenido:
  // no dice de quién son ni qué mandaron.
  remainingConnections?: number
  // El cliente (issue #154) sobre el que actuó el padre. Es un uuid interno,
  // nunca su nombre ni su correo.
  clientAccountId?: string
}

type SubjectFields = {
  // El sujeto del evento, con el mismo criterio que `DeliverySubject`:
  // nombrarlo evita que las métricas de comentarios y de mensajes se mezclen.
  subject?: "message" | "comment"
  subjectId?: string // uuid interno de la fila
  providerId?: string // `mid` de Meta o `ig_comment_id`
  contactId?: string // PSID / IGSID de quien escribió
  textLength?: number
  // Adjunto entrante (migración 0016). Solo el tipo, nunca la URL: la URL la
  // firma el CDN de Meta y apunta a contenido del usuario, que por la regla de
  // este módulo no se loguea. `droppedCount` cuenta los adjuntos extra que se
  // descartaron cuando el contacto mandó varios de una vez.
  attachmentType?: string
  droppedCount?: number
}

type ContextFields = {
  requestId?: string
  // El job de `external_webhook_jobs`. Es la clave con la que el runbook de la
  // DLQ cruza el log con la bitácora de intentos.
  jobId?: string
  // El id del mensaje **de la cola de Cloudflare**, que no es el id de un
  // mensaje de Resender. Van con nombres distintos justamente porque antes los
  // dos viajaban bajo la misma clave.
  queueMessageId?: string
  route?: string
  status?: number
  attempt?: number
  count?: number
  durationMs?: number
  errorCode?: string | number // código de Meta, código de Postgres, etc.
  errorSubcode?: number
  errorMessage?: string // se trunca y se limpia acá adentro, no en el llamador
  // Conteos del sobre del webhook. Van sueltos y no anidados para que se pueda
  // filtrar por ellos: `$.count = 0 AND $.messagingCount > 0` es la consulta de
  // «el parser dejó de reconocer el payload».
  entryCount?: number
  messagingCount?: number
  changeCount?: number
  fields?: string[]
  // Sube el nivel de un descarte que sí es una alarma. Por defecto un descarte
  // es `info`: una cuenta desconectada a la que Meta le sigue mandando eventos
  // es la operación normal, no un error.
  level?: LogLevel
}

type BaseFields = {
  entrypoint: LogEntrypoint
  action: LogAction
} & AccountFields &
  SubjectFields &
  ContextFields

// El corazón del módulo: sin `reason` no se puede reportar nada que no sea `ok`.
export type LogInput =
  | (BaseFields & { outcome: "ok"; reason?: never })
  | (BaseFields & { outcome: Exclude<LogOutcome, "ok">; reason: LogReason })

const LEVEL_BY_OUTCOME: Record<LogOutcome, LogLevel> = {
  ok: "info",
  dropped: "info",
  duplicate: "info",
  skipped: "info",
  retry: "warn",
  failed: "error",
  dead: "error",
}

// Segunda línea de defensa detrás del tipo: si un secreto se cuela dentro del
// mensaje de un error —una URL del Graph con `access_token=` en el query, que
// es exactamente cómo llama `sendMetaTextMessage`— no sale de acá.
const SECRET_PATTERNS: RegExp[] = [
  /\b(access_token|client_secret|appsecret_proof|verify_token|code)=[^\s&"']+/gi,
  /\bsha256=[0-9a-f]{64}\b/gi,
  /\bEA[A-Za-z0-9]{40,}\b/g, // tokens de Facebook
  /\bIG[A-Za-z0-9]{40,}\b/g, // tokens de Instagram
  /\b[sr]k_(live|test)_[A-Za-z0-9]+\b/g, // Stripe
  /\bpk_live_[A-Za-z0-9]+\b/g, // API keys de Resender
]

const MAX_ERROR_MESSAGE = 300

function scrub(value: string) {
  let out = value
  for (const pattern of SECRET_PATTERNS) {
    // `replace` con un regex global consume `lastIndex`; los patrones son
    // constantes de módulo, así que se resetea antes de cada uso.
    pattern.lastIndex = 0
    out = out.replace(pattern, "[redacted]")
  }
  return out.length > MAX_ERROR_MESSAGE
    ? `${out.slice(0, MAX_ERROR_MESSAGE)}…`
    : out
}

// Convierte cualquier cosa lanzada en un string seguro. Existe para que ningún
// llamador tenga la tentación de pasar el `error` entero: el tipo no lo acepta,
// y esta es la alternativa.
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "unknown error"
}

export function log(input: LogInput) {
  const { level, errorMessage, ...fields } = input
  const record = {
    worker: "web" as const,
    environment: process.env.ENVIRONMENT ?? "development",
    // Denormalizado a propósito: es la columna que se lee de un vistazo en el
    // panel, y como la calcula el logger no hay dos call sites que la escriban
    // distinto.
    event: `${input.action}_${input.outcome}`,
    ...fields,
    ...(errorMessage ? { errorMessage: scrub(errorMessage) } : {}),
  }

  const resolved = level ?? LEVEL_BY_OUTCOME[input.outcome]
  if (resolved === "error") {
    console.error(record)
    return
  }
  if (resolved === "warn") {
    console.warn(record)
    return
  }
  console.log(record)
}

// Proyecta una cuenta conectada a los campos de cuenta del log. Existe para que
// «cuenta» esté completa o ausente, nunca a medias: si cada call site armara
// los cuatro campos a mano, en la mitad faltaría `channel` —que es justo el que
// distingue un IG ID de un page id, ambiguos entre canales desde la 0013—.
export function accountFields(page: {
  id: string
  tenantId: string
  channel: PageChannel
  metaPageId: string
  username: string | null
}): AccountFields {
  return {
    tenantId: page.tenantId,
    connectionId: page.id,
    channel: page.channel,
    accountId: page.metaPageId,
    ...(page.username ? { accountHandle: page.username } : {}),
  }
}

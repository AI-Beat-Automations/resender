// La versión de Graph, en un solo sitio.
//
// Hoy está escrita a mano en cinco módulos —`lib/meta.ts`, `lib/instagram.ts`,
// `lib/outbound/meta-send.ts`, `lib/outbound/instagram-send.ts` y
// `lib/outbound/instagram-comment-reply.ts`—, y ese es exactamente el patrón que
// este archivo existe para no repetir: subir de versión hoy es tocar cinco
// literales, y olvidarse de uno deja a un canal hablándole a Graph distinto que
// a los otros sin que nada lo diga. Un canal nuevo hereda el problema
// multiplicado, así que el canal de WhatsApp entra por acá y los cinco sitios
// viejos migran en un paso aparte.
//
// **Se lee del entorno, no se congela en el build.** Meta deprecia versiones con
// unos dos años de vida y la ventana entre «esta versión ya no responde» y «hay
// un deploy nuevo» se cubre con una variable, no con un PR. El default es la
// versión con la que el código está probado.
const DEFAULT_GRAPH_VERSION = "v23.0"

// Qué es una versión de Graph: `v` + mayor + `.` + menor. Nada más.
//
// La validación no es decorativa. Un valor mal escrito —`23.0` sin la `v`, un
// espacio pegado del copiar y pegar, `latest`— no rompe al arrancar: rompe en la
// primera llamada a Meta, con un 404 de Graph que parece un problema de permisos
// o de id y manda a investigar al sitio equivocado. Fallar en el import, con el
// valor recibido en el mensaje, convierte media hora de diagnóstico en una línea
// de log.
const GRAPH_VERSION_PATTERN = /^v\d+\.\d+$/

export function assertGraphVersion(value: string): string {
  if (!GRAPH_VERSION_PATTERN.test(value)) {
    throw new Error(
      `META_GRAPH_VERSION is malformed: received "${value}". ` +
        `It must look like "${DEFAULT_GRAPH_VERSION}": a "v", the major, a dot and the minor.`
    )
  }
  return value
}

export const META_GRAPH_VERSION = assertGraphVersion(
  process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION
)

// Los dos hosts, que no son intercambiables: `graph.facebook.com` es el Graph de
// Facebook —Messenger, WhatsApp Cloud API y el canje de códigos de la app de
// Meta— y `graph.instagram.com` es el de Instagram Login, donde el token de
// Instagram es el único que sirve. Cruzarlos da un 400 que no nombra la causa.
export const GRAPH_FACEBOOK_HOST = "https://graph.facebook.com"
export const GRAPH_INSTAGRAM_HOST = "https://graph.instagram.com"

// Las bases ya versionadas, que es lo que los clientes concatenan.
export const GRAPH_FACEBOOK_BASE = `${GRAPH_FACEBOOK_HOST}/${META_GRAPH_VERSION}`
export const GRAPH_INSTAGRAM_BASE = `${GRAPH_INSTAGRAM_HOST}/${META_GRAPH_VERSION}`

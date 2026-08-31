import { toNextJsHandler } from "better-auth/next-js"

import { getAuth } from "@/lib/auth/auth"
import { allowAuthAttempt } from "@/lib/auth/rate-limit"

// Superficie HTTP de Better Auth. Reemplaza a `[...nextauth]`: el catch-all se
// llama `all` porque la librería monta bajo `/api/auth/*` todos sus endpoints
// (`sign-in/email`, `sign-out`, `get-session`, …), no solo el callback.
export const runtime = "nodejs"

// `getAuth()` es perezoso a propósito (ver `lib/auth/auth.ts`): el handler se
// resuelve por request para que el contexto no se construya durante el build.
const handlers = toNextJsHandler((request: Request) =>
  getAuth().handler(request)
)

// El plugin `apiKey` monta seis endpoints HTTP bajo `/api/auth/api-key/*`
// —`create`, `update`, `delete`, `get`, `list` y `delete-all-expired-api-keys`—
// que el issue #88 nunca pidió y que el producto no usa: Ajustes le habla al
// plugin **desde el servidor** (`lib/auth/api-keys.ts` → `getAuth().api.*`), sin
// pasar por HTTP, y en el repositorio no existe ningún `authClient`. Acá se
// cierran los seis.
//
// El que obliga a hacerlo es `POST /api/auth/api-key/delete`: hace **borrado
// duro** de la fila, así que el propio dueño, desde la consola del navegador y
// con su cookie de sesión, puede hacer desaparecer una key. Eso contradice el
// invariante escrito en CONTEXT.md → [Gestion de API keys en Settings]: una key
// revocada sigue en la lista con su estado y **no desaparece del historial
// operativo**, porque el producto revoca apagando (`enabled: false`) y no
// borrando. El plugin 1.7.2 no tiene ninguna bandera de configuración para
// apagar un endpoint suelto —los seis salen fijos de `createApiKeyRoutes()`—,
// así que el corte va en el único lugar donde esa superficie HTTP existe, que es
// este route handler.
//
// Se cierran los seis y no solamente `delete` por dos razones: la regla queda
// siendo una sola frase verificable —"a las API keys se les habla desde el
// servidor y por ningún otro lado"—, y dejar `create`/`update` abiertos dejaría
// viva una segunda puerta a la emisión y a la revocación que nadie decidió
// abrir. Ninguno de los caminos que usa la UI pasa por acá.
//
// Responde 404 y no 403 por el mismo criterio que `revokeApiKey` con una key
// ajena: confirmar que la ruta existe es justo lo que no hace falta decirle a
// quien la está probando. Es además lo que Better Auth ya contesta para un path
// que no conoce, así que desde afuera el plugin simplemente no está montado.
const API_KEY_PLUGIN_BASE_PATH = "/api/auth/api-key"

function isApiKeyPluginRoute(request: Request) {
  const { pathname } = new URL(request.url)
  return (
    pathname === API_KEY_PLUGIN_BASE_PATH ||
    pathname.startsWith(`${API_KEY_PLUGIN_BASE_PATH}/`)
  )
}

function notFound() {
  return Response.json(
    { code: "NOT_FOUND", message: "Not Found" },
    { status: 404 }
  )
}

// `list` y `get` del plugin son GET; por eso el corte también va acá y no solo
// en el `POST`.
export async function GET(request: Request) {
  if (isApiKeyPluginRoute(request)) return notFound()

  return handlers.GET(request)
}

// El `POST` es la puerta pública: `sign-in/email` y `sign-up/email` viven acá y
// se pueden martillar con `curl` salteándose por completo los server actions,
// que son la otra puerta con límite. Por eso el rate limit va envolviendo el
// handler y no dentro de él.
export async function POST(request: Request) {
  if (isApiKeyPluginRoute(request)) return notFound()

  if (!(await allowAuthAttempt(request.headers))) {
    return Response.json(
      { code: "TOO_MANY_REQUESTS", message: "Too many requests" },
      { status: 429 }
    )
  }

  return handlers.POST(request)
}

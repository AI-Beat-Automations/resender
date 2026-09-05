import { NextResponse } from "next/server"

// `noindex` para todo lo que corre como staging: el custom domain
// `staging.resender.dev` y, desde que `env.staging` tiene `preview_urls: true`
// (wrangler.jsonc), también `<hash>-web-staging.<subdominio>.workers.dev`,
// un host por PR y uno más para la versión desplegada. Son copias enteras e
// idénticas de resender.dev; sin esta cabecera Google las indexa y parte la
// autoridad entre hosts. Cloudflare Access es la barrera principal; esto es
// la red por debajo, para el día que Access falte en alguno de esos hosts.
//
// Por qué `middleware.ts` y no `proxy.ts`: en Next 16 `proxy.ts` corre solo
// en runtime Node y OpenNext para Cloudflare lo rechaza en el build ("Node.js
// middleware is not currently supported"); `middleware.ts` sigue compilando
// como edge middleware, que sí soporta. Next avisa de que la convención está
// deprecada; se asume hasta que OpenNext soporte proxy en Node.
//
// Por qué un middleware y no `headers()` en next.config.ts: ese `headers()` se
// evalúa en build y queda escrito en el manifest de rutas, y `ENVIRONMENT`
// es una `var` del Worker que solo existe en runtime — en build vale
// `undefined` para todos los entornos. Con la cabecera acá se decide por
// request, con la misma lectura de `process.env.ENVIRONMENT` que hace
// `lib/observability/logger.ts`. Y no va en `worker.ts`: ese archivo no
// envuelve `fetch` a propósito.
//
// Cubre solo lo que pasa por el Worker: páginas (también las prerenderizadas,
// que salen del cache de assets vía el Worker), RSC, server actions y
// `/api/*`. Lo que sirve el binding de assets sin tocar el Worker
// (`/_next/static/*`, archivos de `public/`) queda sin la cabecera, y no
// importa: no es HTML.
const NOINDEX = "noindex, nofollow"

export function middleware() {
  const response = NextResponse.next()
  if (process.env.ENVIRONMENT === "staging") {
    response.headers.set("X-Robots-Tag", NOINDEX)
  }
  return response
}

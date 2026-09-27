// Envío a Sentry de los logs de un request del sitio, **después** de haber
// respondido.
//
// Por qué hace falta: el SDK junta los logs en un buffer y los manda cada 5 s
// con un `setTimeout`. En Workers, cuando terminan el request y su
// `waitUntil`, el isolate se congela y ese timer no corre nunca: los logs de la
// ruta y de `after()` se perdían si no llegaba otro request detrás. El SDK sabe
// hacer este flush solo, pero únicamente en Vercel Edge (`vercelWaitUntil` en
// `@sentry/core`), así que en Cloudflare hay que pedirlo.
//
// Cómo: OpenNext registra todo el trabajo del request —el render, el stream de
// la respuesta y cada `after()`— con `ctx.waitUntil`. Se le pasa un `ctx` que
// anota esas promesas, y cuando se resolvieron todas se hace el flush, también
// dentro de `waitUntil`. La respuesta no espera nada de esto.

// Por debajo del techo de 30 s de `waitUntil`: si alguna tarea no termina,
// igual se manda lo que haya antes de que Cloudflare corte.
const MAX_WAIT_MS = 25_000

export type TrackedContext = {
  ctx: WorkerExecutionContext
  // Se resuelve cuando todas las tareas anotadas terminaron (bien o mal), o al
  // vencer `MAX_WAIT_MS`. Nunca se rechaza.
  settled(): Promise<void>
}

export function trackWaitUntil(
  ctx: WorkerExecutionContext,
  maxWaitMs = MAX_WAIT_MS
): TrackedContext {
  const pending: Promise<unknown>[] = []

  // Objeto propio y no `Object.create(ctx)`: los métodos nativos del
  // `ExecutionContext` lanzan «Illegal invocation» con otro `this`.
  const tracked: WorkerExecutionContext = {
    waitUntil(promise) {
      pending.push(promise)
      ctx.waitUntil(promise)
    },
    passThroughOnException() {
      ctx.passThroughOnException()
    },
  }
  // Lo que el runtime agregue al contexto (`props`, `exports`) sigue visible.
  for (const key of ["props", "exports"] as const) {
    if (key in ctx) {
      Object.defineProperty(tracked, key, {
        get: () => (ctx as unknown as Record<string, unknown>)[key],
      })
    }
  }

  async function drain() {
    // Una tarea puede registrar otras mientras corre (`after()` dentro del
    // handler, que a su vez está en `waitUntil`): se espera hasta que no quede
    // ninguna nueva.
    let seen = 0
    while (seen < pending.length) {
      const batch = pending.slice(seen)
      seen = pending.length
      await Promise.allSettled(batch)
    }
  }

  return {
    ctx: tracked,
    settled() {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, maxWaitMs)
      })
      return Promise.race([drain(), timeout]).finally(() => clearTimeout(timer))
    },
  }
}

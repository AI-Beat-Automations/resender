import { describe, expect, it, vi } from "vitest"

import { trackWaitUntil } from "./request-flush"

function fakeCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } satisfies WorkerExecutionContext
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// El `ctx` anotado reemplaza al de Cloudflare en todo el sitio: tiene que
// seguir delegando igual, y `settled()` es lo único que decide cuándo sale el
// flush de Sentry.
describe("trackWaitUntil", () => {
  it("delega waitUntil y passThroughOnException al ctx original", () => {
    const ctx = fakeCtx()
    const tracked = trackWaitUntil(ctx)
    const task = Promise.resolve()

    tracked.ctx.waitUntil(task)
    tracked.ctx.passThroughOnException()

    expect(ctx.waitUntil).toHaveBeenCalledWith(task)
    expect(ctx.passThroughOnException).toHaveBeenCalledTimes(1)
  })

  it("sigue funcionando desacoplado, como lo usa OpenNext (`waitUntil.bind`)", () => {
    const ctx = fakeCtx()
    const tracked = trackWaitUntil(ctx)
    const waitUntil = tracked.ctx.waitUntil.bind(tracked.ctx)

    waitUntil(Promise.resolve())

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
  })

  it("se resuelve solo cuando terminó todo, incluido lo que se registró después", async () => {
    const tracked = trackWaitUntil(fakeCtx())
    const handler = deferred()
    const afterTask = deferred()
    tracked.ctx.waitUntil(handler.promise)

    let done = false
    const settled = tracked.settled().then(() => {
      done = true
    })

    // El handler registra un `after()` mientras corre.
    tracked.ctx.waitUntil(afterTask.promise)
    handler.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(false)

    afterTask.resolve()
    await settled
    expect(done).toBe(true)
  })

  it("no se rechaza si una tarea falla", async () => {
    const tracked = trackWaitUntil(fakeCtx())
    const task = deferred()
    tracked.ctx.waitUntil(task.promise)
    task.reject(new Error("boom"))

    await expect(tracked.settled()).resolves.toBeUndefined()
  })

  it("no espera más que el techo si una tarea no termina nunca", async () => {
    vi.useFakeTimers()
    try {
      const tracked = trackWaitUntil(fakeCtx(), 1000)
      tracked.ctx.waitUntil(new Promise(() => {}))

      const settled = tracked.settled()
      await vi.advanceTimersByTimeAsync(1000)

      await expect(settled).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it("expone lo que el runtime agrega al contexto", () => {
    const ctx = { ...fakeCtx(), props: { a: 1 } }
    const tracked = trackWaitUntil(ctx)

    expect((tracked.ctx as unknown as { props: unknown }).props).toEqual({
      a: 1,
    })
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  allowAuthAttempt: vi.fn(),
  handler: vi.fn(),
}))

vi.mock("@/lib/auth/auth", () => ({
  getAuth: () => ({ handler: mocks.handler }),
}))

vi.mock("@/lib/auth/rate-limit", () => ({
  allowAuthAttempt: mocks.allowAuthAttempt,
}))

const { GET, POST } = await import("./route")

beforeEach(() => {
  vi.clearAllMocks()
  mocks.allowAuthAttempt.mockResolvedValue(true)
  mocks.handler.mockResolvedValue(Response.json({ ok: true }, { status: 200 }))
})

const request = (method: string, path: string) =>
  new Request(`https://app.resender.test${path}`, { method })

// Lo que este test protege es el invariante de CONTEXT.md → [Gestion de API
// keys en Settings]: a las API keys se les habla desde el servidor y por ningún
// otro lado. El plugin monta seis endpoints HTTP que el producto no usa, y uno
// de ellos —`delete`— hace borrado duro: si volvieran a quedar montados, el
// dueño de una key podría borrarla del historial operativo desde la consola del
// navegador. Que el handler ni siquiera se llame es la mitad de la aserción: no
// alcanza con que la respuesta sea 404, tiene que no haber llegado al plugin.
describe("superficie HTTP del plugin apiKey", () => {
  it.each([
    ["POST", "/api/auth/api-key/delete"],
    ["POST", "/api/auth/api-key/create"],
    ["POST", "/api/auth/api-key/update"],
    ["POST", "/api/auth/api-key/delete-all-expired-api-keys"],
  ])("cierra %s %s con 404", async (_method, path) => {
    const response = await POST(request("POST", path))

    expect(response.status).toBe(404)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  // `list` y `get` son GET: el corte tiene que estar en los dos verbos.
  it.each([
    ["GET", "/api/auth/api-key/list"],
    ["GET", "/api/auth/api-key/get"],
  ])("cierra %s %s con 404", async (_method, path) => {
    const response = await GET(request("GET", path))

    expect(response.status).toBe(404)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  // 404 y no 403: desde afuera el plugin no está montado. Confirmar que la ruta
  // existe es justo lo que no hace falta decirle a quien la prueba.
  it("no dice que la ruta existe", async () => {
    const response = await POST(request("POST", "/api/auth/api-key/delete"))

    await expect(response.json()).resolves.toEqual({
      code: "NOT_FOUND",
      message: "Not Found",
    })
  })

  // El corte es por prefijo, así que tiene que morder solo ahí: un path que
  // apenas se le parece sigue siendo del plugin de sesión.
  it("no toca ninguna otra ruta de Better Auth", async () => {
    await expect(
      POST(request("POST", "/api/auth/sign-in/email"))
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      GET(request("GET", "/api/auth/get-session"))
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      POST(request("POST", "/api/auth/api-keyed/whatever"))
    ).resolves.toMatchObject({ status: 200 })

    expect(mocks.handler).toHaveBeenCalledTimes(3)
  })
})

describe("rate limit del POST", () => {
  it("sigue cortando con 429 antes de llegar al handler", async () => {
    mocks.allowAuthAttempt.mockResolvedValue(false)

    const response = await POST(request("POST", "/api/auth/sign-in/email"))

    expect(response.status).toBe(429)
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  // El 404 del plugin de keys no consume una ficha del rate limit: se corta
  // antes, porque no es un intento de autenticación.
  it("no se consulta para una ruta cerrada", async () => {
    await POST(request("POST", "/api/auth/api-key/delete"))

    expect(mocks.allowAuthAttempt).not.toHaveBeenCalled()
  })
})

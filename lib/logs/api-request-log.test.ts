import { beforeEach, describe, expect, it, vi } from "vitest"

const logApiRequest = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("./request-log", () => ({ logApiRequest }))
// Fuera de una request `after` lanza, y el envoltorio cae a la promesa suelta.
vi.mock("next/server", () => ({
  after: () => {
    throw new Error("outside request scope")
  },
}))

const { describeApiResponse, withApiRequestLog } = await import(
  "./api-request-log"
)

const META = {
  channel: "messenger",
  eventType: "send",
  endpoint: "/api/meta/send",
} as const

const ACCOUNT = {
  id: "page-uuid",
  tenantId: "tenant-1",
  clientAccountId: null,
  channel: "messenger" as const,
  metaPageId: "page_1",
  name: "Clínica",
  username: null,
}

function request(body: unknown) {
  return new Request("https://resender.dev/api/meta/send", {
    method: "POST",
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest
}

beforeEach(() => logApiRequest.mockClear())

describe("withApiRequestLog", () => {
  it("guarda la request y la respuesta que realmente salió", async () => {
    const POST = withApiRequestLog(META, async (req, capture) => {
      capture.setRequestId("req-1")
      capture.setTenant("tenant-1")
      capture.setAccount(ACCOUNT)
      capture.setSubject({ contactId: "psid_1" })
      // La ruta sigue pudiendo leer su body: el envoltorio leyó un clon.
      expect(await req.json()).toEqual({ reply: "hola" })
      return Response.json(
        {
          error: "Token vencido",
          meta: { error: { code: 190, error_subcode: 463, message: "Expired" } },
          resender: { conversationId: "conv-1", messageId: "msg-1" },
        },
        { status: 400 }
      )
    })

    const response = await POST(request({ reply: "hola" }))
    // El bot recibe su respuesta intacta.
    expect(response.status).toBe(400)
    expect((await response.json()).resender.messageId).toBe("msg-1")

    await vi.waitFor(() => expect(logApiRequest).toHaveBeenCalledTimes(1))
    expect(logApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        endpoint: "/api/meta/send",
        httpStatus: 400,
        requestId: "req-1",
        account: ACCOUNT,
        messageId: "msg-1",
        conversationId: "conv-1",
        contactId: "psid_1",
        errorCode: "meta:190/463",
        errorMessage: "Token vencido — Meta: Expired",
        requestBody: '{"reply":"hola"}',
      })
    )
  })

  it("sin tenant resuelto (401) no guarda nada", async () => {
    const POST = withApiRequestLog(META, async () =>
      Response.json({ error: "unauthorized" }, { status: 401 })
    )
    expect((await POST(request({}))).status).toBe(401)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(logApiRequest).not.toHaveBeenCalled()
  })
})

describe("describeApiResponse", () => {
  it("un éxito no trae error y saca el id de Meta", () => {
    expect(
      describeApiResponse(
        JSON.stringify({
          meta: { message_id: "mid.1" },
          resender: { messageId: "m", conversationId: "c" },
        })
      )
    ).toEqual({
      messageId: "m",
      commentId: null,
      conversationId: "c",
      providerId: "mid.1",
      errorCode: null,
      errorMessage: null,
    })
  })

  it("lee el wamid de WhatsApp y el código propio de un 4xx nuestro", () => {
    expect(
      describeApiResponse(JSON.stringify({ meta: { messages: [{ id: "wamid.1" }] } }))
        .providerId
    ).toBe("wamid.1")
    expect(
      describeApiResponse(
        JSON.stringify({ code: "attachment_too_large", error: "Muy grande" })
      )
    ).toMatchObject({
      errorCode: "attachment_too_large",
      errorMessage: "Muy grande",
    })
  })

  it("un cuerpo que no es JSON no rompe", () => {
    expect(describeApiResponse("<html>").errorMessage).toBeNull()
    expect(describeApiResponse(null).messageId).toBeNull()
  })
})

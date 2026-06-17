import { auth } from "@/auth"
import { getRecent, subscribe, type IncomingMessage } from "@/lib/message-store"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// SSE: emite el backlog del buffer y luego cada mensaje nuevo en tiempo real.
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response("unauthorized", { status: 401 })
  }

  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  let ping: ReturnType<typeof setInterval>

  const stream = new ReadableStream({
    start(controller) {
      const send = (m: IncomingMessage) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(m)}\n\n`))
        } catch {
          // controller ya cerrado
        }
      }

      // backlog: lo que ya hay en el buffer
      for (const m of getRecent()) send(m)

      unsubscribe = subscribe(send)

      // comentario keep-alive para que proxies no cierren la conexión
      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`))
        } catch {
          // noop
        }
      }, 25000)
    },
    cancel() {
      unsubscribe()
      clearInterval(ping)
    },
  })

  // si el cliente cierra la pestaña/navega, limpiamos también
  request.signal.addEventListener("abort", () => {
    unsubscribe()
    clearInterval(ping)
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

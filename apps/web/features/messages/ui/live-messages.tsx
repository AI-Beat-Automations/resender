"use client"

import { useEffect, useState } from "react"

type IncomingMessage = {
  id: string
  pageId: string
  senderId: string
  text: string
  eventType: "message" | "postback"
  postbackPayload: string | null
  at: number
}

// Bolita por mensaje: al hacer clic copia un curl listo para responder a ESE
// contacto vía POST /api/meta/send (el token lo resuelve el servidor, no va aquí).
function ReplyDot({
  pageId,
  recipientId,
}: {
  pageId: string
  recipientId: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const endpoint = `${window.location.origin}/api/meta/send`
    const body = JSON.stringify({
      pageId,
      recipientId,
      reply: "Your reply here",
    })
    const curl = `curl -X POST '${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -d '${body}'`

    try {
      await navigator.clipboard.writeText(curl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard bloqueado (contexto no seguro)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied!" : "Copy curl to reply to this message"}
      aria-label="Copy curl to reply to this message"
      className={`mt-1 size-4 shrink-0 rounded-full transition-colors ${
        copied ? "bg-green-500" : "bg-primary hover:bg-primary/80"
      }`}
    />
  )
}

export function LiveMessages() {
  const [messages, setMessages] = useState<IncomingMessage[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const es = new EventSource("/api/meta/events")
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (e) => {
      const m = JSON.parse(e.data) as IncomingMessage
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev // dedupe por mid
        return [m, ...prev].slice(0, 50)
      })
    }
    return () => es.close()
  }, [])

  return (
    <section>
      <div className="flex items-center gap-2">
        <h2 className="font-medium">Live messages</h2>
        <span
          className={`size-2 rounded-full ${connected ? "bg-green-500" : "bg-muted-foreground"}`}
          aria-label={connected ? "connected" : "disconnected"}
        />
      </div>
      {messages.length === 0 ? (
        <p className="mt-2 text-muted-foreground">
          Waiting for messages… message your connected Page.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className="flex items-start gap-2 rounded-lg border border-border p-2"
            >
              <ReplyDot pageId={m.pageId} recipientId={m.senderId} />
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground text-xs">
                  page {m.pageId} · from {m.senderId} · {m.eventType} ·{" "}
                  {new Date(m.at).toLocaleTimeString()}
                </div>
                <div className="break-words">{m.text}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

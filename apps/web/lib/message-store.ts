// Buffer en memoria + pub/sub para mostrar mensajes entrantes en vivo (SSE).
// TEMPORAL: se pierde al reiniciar el server. En la Fase 3 se reemplaza por Neon.
export type IncomingMessage = {
  id: string // mid de Meta (o uno generado)
  pageId: string // página que recibió — futura llave de tenant
  senderId: string // PSID del usuario
  text: string
  eventType: "message" | "postback"
  postbackPayload: string | null
  at: number // epoch ms
}

type Store = {
  buffer: IncomingMessage[]
  subscribers: Set<(m: IncomingMessage) => void>
}

const BUFFER_MAX = 100

// Anclado en globalThis para sobrevivir al HMR de dev y ser un único singleton
// compartido entre el route del webhook (POST) y el de SSE (GET).
const g = globalThis as unknown as { __resenderMessages?: Store }
const store: Store =
  g.__resenderMessages ??
  (g.__resenderMessages = { buffer: [], subscribers: new Set() })

export function addMessage(m: IncomingMessage) {
  store.buffer.push(m)
  if (store.buffer.length > BUFFER_MAX) store.buffer.shift()
  for (const fn of store.subscribers) fn(m)
}

export function getRecent(): IncomingMessage[] {
  return store.buffer.slice()
}

export function subscribe(fn: (m: IncomingMessage) => void): () => void {
  store.subscribers.add(fn)
  return () => {
    store.subscribers.delete(fn)
  }
}

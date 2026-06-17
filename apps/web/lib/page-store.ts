// Page access tokens en memoria (SOLO servidor). TEMPORAL: se pierde al reiniciar
// el server; la Fase 3 (Neon) los persiste cifrados. NUNCA se exponen al cliente.
type Store = { tokens: Map<string, string> }

const g = globalThis as unknown as { __echoPageTokens?: Store }
const store: Store =
  g.__echoPageTokens ?? (g.__echoPageTokens = { tokens: new Map() })

export function setPageToken(pageId: string, token: string) {
  store.tokens.set(pageId, token)
}

export function getPageToken(pageId: string): string | undefined {
  return store.tokens.get(pageId)
}

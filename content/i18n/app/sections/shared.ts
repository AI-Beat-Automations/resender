import type { PageChannel } from "@/lib/pages/page-registry"

// Tipos que comparten varias secciones del diccionario.

export type ChannelMap<T = string> = Record<PageChannel, T>

export type HistorySyncCopy = {
  label: string
  body: string
  /** Solo `failed` y `expired` traen acción; en el resto es `null`. */
  actionLabel: string | null
}

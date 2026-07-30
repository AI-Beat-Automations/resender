export type ConnectedPageView = {
  id: string
  metaPageId: string
  name: string
  status: "active" | "disconnected"
  tokenStatus: "valid" | "invalid"
  tokenErrorLabel: string | null
  webhookUrl: string | null
  webhookSigningEnabled: boolean
  connectedAt: string
  connectedAtLabel: string
  tokenErrorAt: string | null
  tokenErrorAtLabel: string | null
  disconnectedAt: string | null
  disconnectedAtLabel: string | null
}

export type PageQuotaView = {
  activePageCount: number
  maxPages: number
} | null

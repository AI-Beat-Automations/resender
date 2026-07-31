export type SettingsAccountView = {
  email: string
  tenantId: string
}

export type ApiKeyView = {
  id: string
  label: string
  visiblePrefix: string
  status: "active" | "revoked"
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

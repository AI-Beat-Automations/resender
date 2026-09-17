export type ApiKeysDict = {
  createTitle: string
  createBody: string
  labelPlaceholder: string
  labelAria: string
  create: string
  creating: string
  revealTitle: string
  copyKey: string
  listTitle: string
  listBody: string
  empty: string
  headLabel: string
  headPrefix: string
  headStatus: string
  headCreated: string
  headActions: string
  statusActive: string
  statusRevoked: string
  revoke: string
  revoking: string
  /** `{label}` */
  revokeTitle: string
  revokeBody: string
  revokeConfirm: string
}

export const es: ApiKeysDict = {
  createTitle: "Crear API key",
  createBody:
    "Usa API keys opacas para que n8n o tu backend llamen a la API externa de Resender. El secreto completo se muestra una sola vez.",
  labelPlaceholder: "n8n producción",
  labelAria: "Etiqueta de la API key",
  create: "Crear key",
  creating: "Creando…",
  revealTitle: "Copia la key ahora: no vamos a volver a mostrarla.",
  copyKey: "Copiar la API key",
  listTitle: "API keys",
  listBody: "Revocar es inmediato: las llamadas con esa key empiezan a fallar.",
  empty: "Todavía no creaste ninguna API key.",
  headLabel: "ETIQUETA",
  headPrefix: "PREFIJO",
  headStatus: "ESTADO",
  headCreated: "CREADA",
  headActions: "Acciones",
  statusActive: "activa",
  statusRevoked: "revocada",
  revoke: "Revocar",
  revoking: "Revocando…",
  revokeTitle: "Revocar «{label}»",
  revokeBody:
    "El efecto es inmediato: las llamadas que usen esta key empiezan a fallar. La key sigue visible en la lista como revocada, y no se puede volver a activar.",
  revokeConfirm: "Sí, revocar",
}

export const en: ApiKeysDict = {
  createTitle: "Create API key",
  createBody:
    "Use opaque API keys so n8n or your backend can call Resender's external API. The full secret is shown only once.",
  labelPlaceholder: "n8n production",
  labelAria: "API key label",
  create: "Create key",
  creating: "Creating…",
  revealTitle: "Copy the key now: we won't show it again.",
  copyKey: "Copy the API key",
  listTitle: "API keys",
  listBody: "Revoking is immediate: calls using that key start failing.",
  empty: "You haven't created any API key yet.",
  headLabel: "LABEL",
  headPrefix: "PREFIX",
  headStatus: "STATUS",
  headCreated: "CREATED",
  headActions: "Actions",
  statusActive: "active",
  statusRevoked: "revoked",
  revoke: "Revoke",
  revoking: "Revoking…",
  revokeTitle: "Revoke «{label}»",
  revokeBody:
    "The effect is immediate: calls using this key start failing. The key stays visible in the list as revoked, and can't be reactivated.",
  revokeConfirm: "Yes, revoke",
}

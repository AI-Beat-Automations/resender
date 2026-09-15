import { normalizeEmail } from "@/lib/auth/validation"
import type { PageChannel, PageStatus } from "@/lib/pages/page-registry"

// A connected page as seen by the deletion flow: enough to decide whether it
// needs a best-effort Meta webhook unsubscribe before the tenant is wiped.
// `channel` picks which unsubscribe endpoint applies: Messenger and Instagram
// take different hosts, paths and tokens.
//
// `id` y `wabaId` los pide WhatsApp, y los pide juntos. La desuscripción de ese
// canal no cuelga del número sino del WABA (`wabaId`), y solo corresponde
// cuando no le queda ningún número activo — cuenta que se hace sobre todos los
// tenants, porque el WABA es compartido. Sin `id` esa cuenta se ve a sí misma:
// las conexiones que este borrado está por eliminar todavía figuran `active` en
// `connected_pages`, así que un tenant que da de baja su único número contaría
// uno restante y **nunca** desuscribiría. Ver el comentario largo de
// `lib/pages/channel-webhook.ts`.
export type DeletionPage = {
  id: string
  channel: PageChannel
  metaPageId: string
  wabaId: string | null
  status: PageStatus
  pageAccessToken: string
}

// True when the value the user typed matches the account email. Emails are
// stored normalized (trimmed + lowercased), so we compare on the same footing.
export function accountDeletionConfirmationMatches(
  typedValue: unknown,
  accountEmail: string
): boolean {
  const account = normalizeEmail(accountEmail)
  if (!account) return false
  return normalizeEmail(typedValue) === account
}

// Given every connected page of a tenant, return the ones that still need a
// best-effort unsubscribe from Meta's webhook: only active pages with a token.
// Disconnected pages were already unsubscribed (or never matter for new traffic).
export function planWebhookUnsubscribes(pages: DeletionPage[]): DeletionPage[] {
  return pages.filter(
    (page) => page.status === "active" && page.pageAccessToken.length > 0
  )
}

// Las conexiones que este borrado está eliminando, para que la cuenta de
// «números todavía activos en el WABA» no las cuente.
//
// Son **todas** las páginas del tenant, no solo las que se van a desuscribir:
// el `delete from users` se las lleva a todas por cascade, así que una página
// ya desconectada (que no entra en `planWebhookUnsubscribes`) tampoco puede
// seguir contando como activa. El filtro de arriba decide a quién llamar; este
// describe qué desaparece, y son dos preguntas distintas.
export function deletedConnectionIds(pages: DeletionPage[]): string[] {
  return pages.map((page) => page.id)
}

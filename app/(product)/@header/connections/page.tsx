import { Plus } from "lucide-react"

import { ConnectFacebookButton } from "@/features/connect-meta/ui/connect-facebook-button"
import { ConnectInstagramButton } from "@/features/connect-meta/ui/connect-instagram-button"
import { ConnectWhatsAppButton } from "@/features/connect-whatsapp/ui/connect-whatsapp-button"
import {
  listTenantPagesCached,
  resolveChannelAccessCached,
} from "@/features/connections/queries"
import { resolveActorCached } from "@/features/clients/queries"
import { ConsoleHeader } from "@/features/shell/ui/console-header"
import { getSession } from "@/lib/auth/session"
import { getAppDict } from "@/lib/i18n/app-dict"
import { offersChannel } from "@/lib/pages/channel-display"

// Acciones del header de Conexiones (mock `1e`): los tres «Conectar…» en
// `outline` con el «+». En el estado vacío no aparecen: ahí los CTA viven en
// las tarjetas de canal (mock `1f`). Las lecturas van por el caché de
// petición, así la página no las repite.
export default async function ConnectionsHeader() {
  const t = await getAppDict()
  const session = await getSession()
  const crumbs = [{ label: t.connections.title }]

  if (!session?.user?.id) return <ConsoleHeader crumbs={crumbs} t={t} />

  // Mismo actor y mismos argumentos que la página, para que el caché de
  // petición deduplique la lectura y el cliente vea su lista, no la del tenant.
  const resolution = await resolveActorCached(session.user.id)
  if (resolution.kind !== "actor") {
    return <ConsoleHeader crumbs={crumbs} t={t} />
  }
  const { tenantId, clientAccountId } = resolution.actor

  const [pages, access] = await Promise.all([
    listTenantPagesCached(tenantId, clientAccountId),
    resolveChannelAccessCached(tenantId),
  ])
  if (pages.length === 0) return <ConsoleHeader crumbs={crumbs} t={t} />

  return (
    <ConsoleHeader
      crumbs={crumbs}
      t={t}
      actions={
        <>
          <ConnectFacebookButton
            label={t.connections.connectFacebook}
            variant="outline"
            size="default"
            icon={<Plus aria-hidden />}
          />
          {offersChannel("instagram", access) && (
            <ConnectInstagramButton
              label={t.connections.connectInstagram}
              size="default"
              icon={<Plus aria-hidden />}
            />
          )}
          {offersChannel("whatsapp", access) && (
            <ConnectWhatsAppButton layout="header" />
          )}
        </>
      }
    />
  )
}

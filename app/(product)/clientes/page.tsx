import { redirect } from "next/navigation"
import { Lock } from "lucide-react"

import { CreateClientForm } from "@/features/clients/ui/create-client-form"
import {
  ClientsPanel,
  type ClientView,
} from "@/features/clients/ui/clients-panel"
import { resolveClientPlanCached } from "@/features/clients/queries"
import { ConsolePage } from "@/features/shell/ui/console-page"
import { getSession } from "@/lib/auth/session"
import type { AppDict } from "@/content/i18n/app"
import {
  listClientAccounts,
  type ClientListItem,
} from "@/lib/clients/client-accounts"
import { getAppDict } from "@/lib/i18n/app-dict"
import { Alert, AlertContent } from "@/components/ui/alert"

// `/clientes` (issue #154, ticket #155): el padre crea, invita y administra
// clientes. Para Starter y Free la ruta muestra un aviso sin CTA de compra: el
// item del sidebar ya no se dibuja, pero la URL sigue existiendo.
export default async function ClientsPage() {
  const [session, t] = await Promise.all([getSession(), getAppDict()])
  if (!session?.user?.id) redirect("/login")
  const tenantId = session.user.id

  const plan = await resolveClientPlanCached(tenantId)
  const clients = await listClientAccounts(tenantId)

  return (
    <ConsolePage className="flex flex-col gap-5">
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-[-0.02em]">
          {t.clients.title}
        </h1>
        <p className="mt-1.5 max-w-[600px] text-sm/[1.55] text-muted-foreground">
          {t.clients.subtitle}
        </p>
      </header>

      {plan.canManage && plan.maxPages !== null ? (
        <CreateClientForm maxPages={plan.maxPages} />
      ) : (
        <Alert variant="info">
          <Lock />
          <AlertContent>
            <p className="font-medium">{t.clients.gateTitle}</p>
            <p className="mt-0.5">{t.clients.gateBody}</p>
          </AlertContent>
        </Alert>
      )}

      {/* La lista se muestra aunque el plan ya no permita invitar: un padre
          que bajó de plan sigue viendo y pudiendo eliminar a sus clientes. */}
      {clients.length > 0 || plan.canManage ? (
        <ClientsPanel
          clients={clients.map((client) => toClientView(client, t))}
          plan={plan}
          t={t}
        />
      ) : null}
    </ConsolePage>
  )
}

// Lo que el diálogo de eliminar lista: canal y nombre, con el @handle cuando
// hay (Instagram), porque es lo que el padre reconoce.
function toClientView(client: ClientListItem, t: AppDict): ClientView {
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    status: client.status,
    maxConnections: client.maxConnections,
    invitation: client.invitation,
    connections: client.connections.map((connection) => ({
      id: connection.id,
      label: `${t.channels.label[connection.channel]} · ${connection.name}${
        connection.username ? ` (@${connection.username})` : ""
      }`,
    })),
  }
}

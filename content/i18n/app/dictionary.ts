// Contrato de traducción de la app logueada: las siete pantallas que la
// ADR 0005 dejó con español hardcoded en el JSX (`/connections`,
// `/connections/select`, `/inbox`, `/settings`, `/billing`, `/billing/success`)
// más el shell que las envuelve.
//
// Es un diccionario **aparte** del sitio público (`content/i18n/dictionary.ts`)
// y no un bloque más de aquel `Dict`: el copy del landing pesa ~50 KB entre los
// dos idiomas y el producto no lo necesita, así que meterlo en el mismo módulo
// lo arrastraría al bundle del dashboard.
//
// `es.ts` y `en.ts` implementan este mismo tipo, así que si falta una clave en
// cualquiera de los dos el typecheck falla y los idiomas quedan sincronizados a
// la fuerza. Es la misma garantía que da el `Dict` del sitio.
//
// **Solo strings, sin funciones.** Lo que necesita datos lleva `{marcadores}` y
// se interpola con `fmt()` (`./format`). El motivo no es estético: una función
// no cruza el borde servidor→cliente, y este diccionario se pasa entero al
// cliente por contexto para que el sidebar y los formularios lo lean.

// Cada sección vive en `./sections/<seccion>.ts` con su tipo, su español y su
// inglés juntos: para tocar el copy de una pantalla se abre un solo archivo. Este
// módulo solo compone el contrato; `es.ts` y `en.ts` ensamblan los valores.

import type { CommonDict } from "./sections/common"
import type { ShellDict } from "./sections/shell"
import type { QuotaDict } from "./sections/quota"
import type { ChannelsDict } from "./sections/channels"
import type { ConnectionsDict } from "./sections/connections"
import type { ConnectionCardDict } from "./sections/connection-card"
import type { SelectDict } from "./sections/select"
import type { InboxDict } from "./sections/inbox"
import type { LogDict } from "./sections/log"
import type { RequestLogsDict } from "./sections/request-logs"
import type { SettingsDict } from "./sections/settings"
import type { AccountDict } from "./sections/account"
import type { ApiKeysDict } from "./sections/api-keys"
import type { SubscriptionDict } from "./sections/subscription"
import type { AccessPendingDict } from "./sections/access-pending"
import type { InvitationDict } from "./sections/invitation"
import type { ClientRestrictedDict } from "./sections/client-restricted"
import type { ClientLimitsDict } from "./sections/client-limits"
import type { BillingDict } from "./sections/billing"
import type { ClientsDict } from "./sections/clients"
import type { MetaErrorsDict } from "./sections/meta-errors"
import type { ActionsDict } from "./sections/actions"
import type { WhatsappEventsDict } from "./sections/whatsapp-events"
import type { WhatsappSignupDict } from "./sections/whatsapp-signup"

export type { ChannelMap, HistorySyncCopy } from "./sections/shared"

export type AppDict = {
  /**
   * El locale de `Intl` para este idioma. Las fechas y los números del producto
   * se formatean con él en vez de con el `"es-ES"` literal que estaba repetido
   * en seis módulos.
   */
  intl: string

  common: CommonDict
  shell: ShellDict
  quota: QuotaDict
  channels: ChannelsDict
  connections: ConnectionsDict
  connectionCard: ConnectionCardDict
  select: SelectDict
  inbox: InboxDict
  log: LogDict
  requestLogs: RequestLogsDict
  settings: SettingsDict
  account: AccountDict
  apiKeys: ApiKeysDict
  subscription: SubscriptionDict
  accessPending: AccessPendingDict
  invitation: InvitationDict
  clientRestricted: ClientRestrictedDict
  clientLimits: ClientLimitsDict
  billing: BillingDict
  clients: ClientsDict
  metaErrors: MetaErrorsDict
  actions: ActionsDict
  whatsappEvents: WhatsappEventsDict
  whatsappSignup: WhatsappSignupDict
}

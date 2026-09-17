import type { AppDict } from "./dictionary"

import * as common from "./sections/common"
import * as shell from "./sections/shell"
import * as quota from "./sections/quota"
import * as channels from "./sections/channels"
import * as connections from "./sections/connections"
import * as connectionCard from "./sections/connection-card"
import * as select from "./sections/select"
import * as inbox from "./sections/inbox"
import * as log from "./sections/log"
import * as settings from "./sections/settings"
import * as account from "./sections/account"
import * as apiKeys from "./sections/api-keys"
import * as subscription from "./sections/subscription"
import * as accessPending from "./sections/access-pending"
import * as invitation from "./sections/invitation"
import * as clientRestricted from "./sections/client-restricted"
import * as clientLimits from "./sections/client-limits"
import * as billing from "./sections/billing"
import * as clients from "./sections/clients"
import * as metaErrors from "./sections/meta-errors"
import * as actions from "./sections/actions"
import * as whatsappEvents from "./sections/whatsapp-events"
import * as whatsappSignup from "./sections/whatsapp-signup"

// El español del producto. Es el copy que ya estaba en el JSX: la migración al
// diccionario no reescribe nada, solo lo saca de los componentes.
//
// La voz es la de la consola v2 —tuteo neutro—, no el voseo rioplatense del
// landing (`content/i18n/es.ts`). La ADR 0005 decidió que los dos conviven a
// propósito y esto no lo cambia: mueve texto de sitio, no de voz.
export const es: AppDict = {
  intl: "es-ES",
  common: common.es,
  shell: shell.es,
  quota: quota.es,
  channels: channels.es,
  connections: connections.es,
  connectionCard: connectionCard.es,
  select: select.es,
  inbox: inbox.es,
  log: log.es,
  settings: settings.es,
  account: account.es,
  apiKeys: apiKeys.es,
  subscription: subscription.es,
  accessPending: accessPending.es,
  invitation: invitation.es,
  clientRestricted: clientRestricted.es,
  clientLimits: clientLimits.es,
  billing: billing.es,
  clients: clients.es,
  metaErrors: metaErrors.es,
  actions: actions.es,
  whatsappEvents: whatsappEvents.es,
  whatsappSignup: whatsappSignup.es,
}

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
import * as requestLogs from "./sections/request-logs"
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

// El inglés del producto. Mismo registro que el español de la consola: directo,
// segunda persona, sin exclamaciones. Los identificadores técnicos que el
// usuario cita en soporte (`tenant_id`, `page_id`, `waba_id`, los nombres de las
// cabeceras) no se traducen: son literales, no copy.
export const en: AppDict = {
  intl: "en-US",
  common: common.en,
  shell: shell.en,
  quota: quota.en,
  channels: channels.en,
  connections: connections.en,
  connectionCard: connectionCard.en,
  select: select.en,
  inbox: inbox.en,
  log: log.en,
  requestLogs: requestLogs.en,
  settings: settings.en,
  account: account.en,
  apiKeys: apiKeys.en,
  subscription: subscription.en,
  accessPending: accessPending.en,
  invitation: invitation.en,
  clientRestricted: clientRestricted.en,
  clientLimits: clientLimits.en,
  billing: billing.en,
  clients: clients.en,
  metaErrors: metaErrors.en,
  actions: actions.en,
  whatsappEvents: whatsappEvents.en,
  whatsappSignup: whatsappSignup.en,
}

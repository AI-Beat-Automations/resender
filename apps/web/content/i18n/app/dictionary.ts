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

import type {
  AttachmentStatus,
  DeliveryStatus,
} from "@/lib/messages/message-enums"
import type { PageChannel } from "@/lib/pages/page-registry"
import type { HistorySyncStatus } from "@/lib/pages/connection-display"
import type { WhatsappOnboardingMode } from "@/lib/pages/connection-display"
import type { ConnectionStatus } from "@/lib/pages/channel-display"
import type { SettingsTab } from "@/lib/settings/settings-tabs"
import type { InboxTab } from "@/lib/inbox/inbox-tabs"

export type ChannelMap<T = string> = Record<PageChannel, T>

export type HistorySyncCopy = {
  label: string
  body: string
  /** Solo `failed` y `expired` traen acción; en el resto es `null`. */
  actionLabel: string | null
}

export type AppDict = {
  /**
   * El locale de `Intl` para este idioma. Las fechas y los números del producto
   * se formatean con él en vez de con el `"es-ES"` literal que estaba repetido
   * en seis módulos.
   */
  intl: string

  common: {
    save: string
    saving: string
    cancel: string
    copy: string
    copied: string
    dismissNotice: string
    contactEmail: string
  }

  shell: {
    home: string
    navConnections: string
    navInbox: string
    navSettings: string
    navDocs: string
    theme: string
    signOut: string
  }

  quota: {
    warningTitle: string
    /** `{usage}`, `{limit}` */
    warningBody: string
    restrictedTitle: string
    /** `{maxPages}`, `{activePageCount}` */
    blockedPageLimit: string
    /** `{limit}` */
    blockedQuota: string
    blockedPlanUnavailable: string
    blockedDefault: string
    ctaManagePages: string
    ctaContact: string
    ctaUpgrade: string
  }

  channels: {
    label: ChannelMap
    /** «esta página» / «esta cuenta» / «este número». */
    noun: ChannelMap
    tokenInvalidBody: ChannelMap
    onboardingMode: Record<WhatsappOnboardingMode, string>
    historySync: Record<HistorySyncStatus, HistorySyncCopy>
    coexistenceLimits: readonly string[]
    statusBadge: Record<ConnectionStatus, string>
  }

  connections: {
    eyebrow: string
    title: string
    subtitle: string
    connectFacebook: string
    connectInstagram: string
    connectWhatsapp: string
    /** `{description}` del único punto de entrada de WhatsApp. */
    whatsappEntryDescription: string
    whatsappModeCaveat: Record<WhatsappOnboardingMode, string>
    connectedAccountsHeading: string
    /** `{activePageCount}`, `{maxPages}` */
    quota: string
    quotaUnresolved: string
    noticeConnectedGeneric: string
    /** `{username}` */
    noticeInstagramNamed: string
    noticeInstagram: string
    /** `{list}` */
    noticeConnectedOne: string
    /** `{count}`, `{list}` */
    noticeConnectedMany: string
    /** Conjunción de la lista de páginas conectadas: `A, B y C`. */
    listConjunction: string
    empty: {
      facebookTitle: string
      facebookBody: string
      instagramTitle: string
      instagramBody: string
      whatsappTitle: string
      whatsappBody: string
      title: string
      body: string
      step1: string
      step2: string
      step3: string
    }
  }

  connectionCard: {
    /** `{date}` */
    connectedOn: string
    reconnect: string
    reconnectAgain: string
    disconnect: string
    tokenInvalidBadge: string
    /** `{channel}` */
    noAccessTitle: string
    noAccessBody: string
    /** `{noun}` */
    tokenInvalidTitle: string
    /** `{date}` */
    tokenErrorDetectedOn: string
    whatsappOnboardingLabel: string
    whatsappOnboardingUnknown: string
    whatsappTokenLabel: string
    whatsappTokenValid: string
    whatsappTokenRejected: string
    whatsappSubscriptionLabel: string
    whatsappSubscriptionUnknown: string
    coexistenceLimitsTitle: string
    pinTitle: string
    pinBody: string
    pinReveal: string
    pinRevealing: string
    pinHide: string
    pinError: string
    webhookLabel: string
    webhookPlaceholder: string
    webhookHint: string
    signingSecretLabel: string
    rotate: string
    rotating: string
    generate: string
    secretRevealTitle: string
    secretWithBody: string
    secretWithoutBody: string
    /** `{date}` */
    disconnectedOn: string
    disconnectedNoDate: string
    disconnectedHistoryKept: string
    /** `{name}` */
    disconnectTitle: string
    disconnectBody: string
    disconnectConfirm: string
    disconnecting: string
  }

  select: {
    eyebrow: string
    title: string
    subtitle: string
    back: string
    noAuthTitle: string
    noAuthBody: string
    planUnresolvedTitle: string
    planUnresolvedBody: string
    planHeading: string
    /** `{activePageCount}`, `{maxPages}` */
    planUsage: string
    /** `{count}` */
    allowanceOne: string
    /** `{count}` */
    allowanceMany: string
    allowanceNone: string
    emptyTitle: string
    emptyBody: string
    listHeading: string
    badgeConnected: string
    badgeForeign: string
    foreignBody: string
    connectedBody: string
    addOnlyHint: string
    /** `{remainingSlots}`, `{maxPages}` */
    atLimitHint: string
    submit: string
    submitting: string
  }

  inbox: {
    eyebrow: string
    title: string
    subtitle: string
    tabs: Record<InboxTab, string>
    tabsAria: string
    filterAll: string
    conversationsHeading: string
    publicationsHeading: string
    sortedByActivity: string
    emptyConversations: string
    emptyConversationsFiltered: string
    emptyComments: string
    emptyCommentsFiltered: string
    readOnly: string
    readOnlyHint: string
    threadEmpty: string
    /** El vacío del panel derecho, en sus cuatro combinaciones. */
    noConversationsTitle: string
    noConversationsFilteredTitle: string
    noConversationsBody: string
    noConversationsFilteredBody: string
    noCommentsTitle: string
    noCommentsFilteredTitle: string
    noCommentsBody: string
    noCommentsFilteredBody: string
    noInstagramTitle: string
    noInstagramBody: string
    noInstagramCta: string
    openInInstagram: string
    fromCommentTitle: string
    deliveryTitle: string
    reactionOutbound: string
    reactionInbound: string
    imageAlt: string
    /**
     * Lo que la burbuja dice en cada estado del binario (`attachment_status`,
     * 0017). Los cinco son distintos porque los cinco estados son distintos:
     * colapsar `failed` con `unavailable` en un «no se pudo mostrar» genérico
     * deja a soporte sin poder distinguir un bug nuestro de un límite de Meta.
     */
    attachmentStatus: Record<AttachmentStatus, string>
  }

  log: {
    /** `{time}` */
    today: string
    /** `{time}` */
    yesterday: string
    /** Prefijo del último mensaje propio en el renglón del log. */
    you: string
    noMessages: string
    /** `{status}` */
    deliveryPrefix: string
    delivery: Record<DeliveryStatus, string>
    fromCommentSuffix: string
    /** `{author}` */
    replyingTo: string
    commentCountOne: string
    /** `{count}` */
    commentCountMany: string
    /** Sustantivo de la publicación cuando no hay caption. */
    mediaNouns: { feed: string; reels: string; story: string; ad: string }
  }

  settings: {
    eyebrow: string
    title: string
    subtitle: string
    tabs: Record<SettingsTab, string>
    tabsAria: string
    language: {
      title: string
      body: string
      label: string
      es: string
      en: string
    }
  }

  account: {
    title: string
    emailLabel: string
    tenantIdLabel: string
    copyTenantId: string
    passwordTitle: string
    passwordBody: string
    newPassword: string
    newPasswordPlaceholder: string
    confirmPassword: string
    confirmPasswordPlaceholder: string
    passwordHint: string
    passwordSubmit: string
    deleteTitle: string
    deleteBody: string
    deleteCta: string
    deleteDialogTitle: string
    deleteDialogBody: string
    /** `{email}` — el label lleva el email en `<span>`, así que va partido. */
    deleteConfirmBefore: string
    deleteConfirmAfter: string
    deleteConfirm: string
    deleting: string
  }

  apiKeys: {
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
    headLastUsed: string
    headActions: string
    statusActive: string
    statusRevoked: string
    never: string
    /** `{date}` */
    revokedOn: string
    revoke: string
    revoking: string
    /** `{label}` */
    revokeTitle: string
    revokeBody: string
    revokeConfirm: string
  }

  subscription: {
    title: string
    none: string
    noneBody: string
    choosePlan: string
    planLabel: string
    renewsLabel: string
    cancelsLabel: string
    connectionsLabel: string
    /** `{price}` */
    perMonth: string
    periodMessages: string
    usageAria: string
    limitsUnresolved: string
    managePortal: string
    portalHint: string
  }

  /**
   * Pantalla autenticada del gate de acceso (`/pending`): el aterrizaje de la
   * cuenta que acaba de registrarse y todavía no está aprobada. No es la lista
   * de espera pública de `/waitlist`, que es marketing y vive en el otro
   * diccionario.
   */
  accessPending: {
    eyebrow: string
    title: string
    body: string
    emailLabel: string
    helpBefore: string
    helpDocsLink: string
    helpMiddle: string
    helpAfter: string
    signOut: string
  }

  billing: {
    metaTitle: string
    eyebrow: string
    title: string
    subtitle: string
    signOut: string
    perMonth: string
    /** `{messages}`, `{pages}` */
    planLimitsOne: string
    /** `{messages}`, `{pages}` */
    planLimitsMany: string
    subscribe: string
    footnote: string
    successMetaTitle: string
    successTitle: string
    successBody: string
    successSlowBefore: string
    successSlowLink: string
    successSlowMiddle: string
    successSlowAfter: string
  }

  /**
   * Motivos de fallo del callback de Meta. Las claves son los `reason` del
   * querystring; los tres `*_owned` llevan el id interpolado en `{id}`.
   */
  metaErrors: {
    prefix: string
    /** `{reason}` — el motivo desconocido se muestra crudo. */
    unknown: string
    empty: string
    webhookSubscriptionFailed: string
    /** `{id}` */
    pageOwned: string
    configurationFailed: string
    metaSessionExpired: string
    stateMismatch: string
    instagramNotEnabled: string
    instagramPageLimitReached: string
    instagramExchangeFailed: string
    instagramProfileFailed: string
    instagramSubscriptionFailed: string
    /** `{id}` */
    instagramAccountOwned: string
    whatsappNotEnabled: string
    whatsappPageLimitReached: string
    whatsappExchangeFailed: string
    whatsappAssetsFailed: string
    whatsappRegisterFailed: string
    whatsappSubscribeFailed: string
    whatsappSyncRequestFailed: string
    whatsappStateMismatch: string
    whatsappPinRequired: string
    whatsappPersistFailed: string
    /** `{id}` */
    whatsappNumberOwned: string
  }

  /** Lo que devuelven las server actions del producto. */
  actions: {
    notSignedIn: string
    waitlisted: string
    noSubscription: string
    invalidPage: string
    pageNotFound: string
    invalidApiKey: string
    apiKeyNotFound: string
    apiKeyLabelRequired: string
    apiKeyLabelTooLong: string
    apiKeyRevealed: string
    accountNotFound: string
    confirmEmailMismatch: string
    deletePrepareFailed: string
    invalidEmail: string
    passwordTooShort: string
    passwordsDoNotMatch: string
    selectOnePage: string
    selectOneNewPage: string
    planUnresolved: string
    quotaCheckFailed: string
    connectFailed: string
    disconnected: string
    secretRotated: string
    webhookUpdated: string
    webhookUpdatedWithSecret: string
    webhookUrlNotHttps: string
    webhookUrlInvalid: string
    whatsappNotEnabled: string
    whatsappNoPin: string
    /** `{maxPages}`, `{activePageCount}` */
    accountSlotFull: string
    invalidSelection: string
    /** `{maxPages}`, `{activePageCount}` */
    pageLimitPlan: string
    pageLimitNone: string
    /** `{remainingSlots}` */
    pageLimitRemainingOne: string
    /** `{remainingSlots}` */
    pageLimitRemainingMany: string
  }

  /**
   * Cómo se le cuenta al usuario cada desenlace del popup de Meta. Los `steps`
   * son los `current_step` de Meta —claves suyas, no nuestras— traducidos a la
   * voz de la pantalla; un valor que Meta agregue cae fuera del mapa y el
   * mensaje simplemente omite el «te quedaste en…».
   */
  whatsappEvents: {
    finishedWithoutNumber: string
    flowError: string
    malformed: string
    /** `{message}`, `{suffix}` */
    reportedError: string
    /** `{code}` */
    reportedErrorCode: string
    /** `{id}` */
    reportedErrorSession: string
    /** `{reference}` */
    reportedErrorSuffix: string
    /** `{where}` */
    abandoned: string
    /** `{step}` */
    abandonedWhere: string
    unsupportedMigration: string
    unsupportedGrantOnly: string
    /** `{event}` */
    unsupportedOther: string
    steps: Record<string, string>
  }

  whatsappSignup: {
    connect: string
    connecting: string
    description: string
    preparing: string
    nonceFailed: string
    submitFailed: string
    networkFailed: string
    pairingIncomplete: string
    sdkBlocked: string
    popupClosed: string
    notConfigured: string
    pinLabel: string
    pinPlaceholder: string
    pinHint: string
  }
}

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
    /** Solo se dibuja para los planes que pueden invitar (Pro y Business). */
    navClients: string
    navSettings: string
    navDocs: string
    /** Primer nivel del breadcrumb del header de la consola. */
    breadcrumbConsole: string
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
    /** Sufijo del contador `n / m` de la cabecera. */
    quotaActiveSuffix: string
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
      /** Sin numerar: el número lo dibuja la píldora. */
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
    /** Píldora junto al estado cuando el reenvío está pausado (ADR 0020). */
    pausedBadge: string
    /** Interruptor de pausa de reenvío: encabezado, aria y los dos estados. */
    forwardingLabel: string
    forwardingAria: string
    forwardingActive: string
    /** `{since}`: «hace 2 horas», ya en el idioma. */
    forwardingPaused: string
    forwardingPausedNow: string
    forwardingHint: string
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
    /** Valor del campo del secreto cuando todavía no hay uno. */
    secretMissingValue: string
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
    /** Alrededor del rango en mono: `{before}{range}{after}`. */
    planUsageBefore: string
    /** `{activePageCount}`, `{maxPages}` */
    planUsageRange: string
    planUsageAfter: string
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
    title: string
    tabs: Record<InboxTab, string>
    tabsAria: string
    filterAll: string
    /** Combobox de cuenta (mock `1i`): aria del botón, placeholder y vacío. */
    accountPickerLabel: string
    accountPickerSearch: string
    accountPickerEmpty: string
    /** Franja al pie del hilo de mensajes (mock `1h`), con su enlace a docs. */
    readOnlyFooter: string
    readOnlyFooterCta: string
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
    /**
     * Pausa de reenvío de la conversación (ADR 0020), en la cabecera del hilo.
     * Solo etiqueta y switch, sin texto de estado: el desde cuándo lo cuenta
     * el hilo (ADR 0021).
     */
    pauseLabel: string
    pauseAria: string
    /**
     * Eventos de pausa dentro del hilo (ADR 0021), `{date}` ya con hora:
     * «Automatización pausada desde el 14 sep 2026, 10:32».
     */
    pauseEventPaused: string
    pauseEventResumed: string
    /** `title` del icono de pausa en la fila de la lista. */
    pausedRowTitle: string
  }

  log: {
    /** `{time}` */
    today: string
    /** `{time}` */
    yesterday: string
    /** Prefijo del último mensaje propio en el renglón del log. */
    you: string
    noMessages: string
    /** Dirección traducida en el metadato de burbuja (mock `1h`). */
    direction: Record<"inbound" | "outbound", string>
    /** Metadato del comentario propio: `respuesta pública · 09:10`. */
    publicReply: string
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
    /**
     * Nota de la pestaña Cuenta de un cliente (issue #154): quién administra
     * su acceso. `{owner}` es el nombre del padre, o su correo si no tiene.
     */
    managedBy: string
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
    /**
     * Panel «Cómo entras a Resender» ([Cuenta vinculada], issue #98): la fila
     * de estado del correo arriba —solo si no está confirmado—, y debajo las
     * credenciales. `unlink` no se ofrece cuando es la única (la librería
     * rechaza quitar la última) y `link` va deshabilitado con
     * `linkRequiresVerified` al lado mientras el correo no esté confirmado.
     */
    signInMethods: {
      title: string
      body: string
      emailUnverified: string
      emailUnverifiedHint: string
      resend: string
      resendSent: string
      password: string
      passwordConfigured: string
      passwordMissing: string
      google: string
      googleNotLinked: string
      link: string
      linkRequiresVerified: string
      unlink: string
      unlinkHint: string
      lastCredentialHint: string
      linked: string
    }
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
    /**
     * Bloque de [Verificacion de correo], **por encima** del mensaje de
     * aprobación y solo si `isEmailVerified()` es falso (leído vivo, no de la
     * sesión: la cookie de caché la trae vieja hasta cinco minutos).
     * `linkExpired` es lo que dice `/pending?error=TOKEN_EXPIRED` (o
     * `INVALID_TOKEN`), ya clasificado por `classifyVerificationError`.
     */
    verify: {
      title: string
      /** `{email}` */
      body: string
      resend: string
      sent: string
      linkExpired: string
    }
  }

  /**
   * `/invitacion/[token]` (issue #154, ticket #156): el cliente acepta, fija
   * su contraseña y entra. Los cuatro estados sin acción —vencida, cancelada,
   * ya usada, desconocida— explican y no ofrecen nada: el padre reenvía.
   */
  invitation: {
    eyebrow: string
    title: string
    /** `{owner}`: el nombre del padre. */
    body: string
    nameLabel: string
    emailLabel: string
    passwordLabel: string
    passwordPlaceholder: string
    passwordHint: string
    confirmPasswordLabel: string
    confirmPasswordPlaceholder: string
    submit: string
    submitting: string
    expiredTitle: string
    expiredBody: string
    cancelledTitle: string
    cancelledBody: string
    consumedTitle: string
    consumedBody: string
    unknownTitle: string
    unknownBody: string
  }

  /**
   * Cuenta restringida de un cliente (issue #154): el padre perdió su
   * suscripción. Misma pantalla que ve el padre, sin CTA de pago: el cliente
   * nunca ve planes ni precios. `{owner}` es el nombre del padre.
   */
  clientRestricted: {
    eyebrow: string
    title: string
    body: string
    /** Sin padre resuelto (cliente con acceso todavía no activo). */
    bodyNoOwner: string
    signOut: string
  }

  /**
   * Cupo del cliente al conectar (issue #154, ticket 3). Todos los textos
   * nombran al padre (`{owner}`) y ninguno menciona planes ni precios.
   */
  clientLimits: {
    /** Cómo se nombra al padre si no se pudo resolver su nombre. */
    ownerFallback: string
    /** Cabecera del contador `n / m` del cliente en Conexiones y en la selección. */
    heading: string
    /** Sufijo del contador `n / m` de la cabecera de Conexiones. */
    counterSuffix: string
    nearTitle: string
    /** `{owner}`, `{activePageCount}`, `{maxConnections}` */
    nearBody: string
    reachedTitle: string
    /** `{owner}`, `{activePageCount}`, `{maxConnections}` */
    reachedBody: string
    tenantReachedTitle: string
    /** `{owner}` */
    tenantReachedBody: string
    /** `{owner}` */
    rejectedOwn: string
    /** `{owner}` */
    rejectedTenant: string
    /** `{remainingSlots}` */
    selectAtLimitHint: string
    /** `{remainingSlots}` */
    selectionOverflow: string
    /** Fallo al leer el tope o el cupo: fail-closed, sin nombrar el plan. */
    checkFailed: string
    /**
     * El cliente no puede conectar porque su acceso está en pausa (el padre
     * sin suscripción activa o la invitación aún pendiente). Sin nombrar la
     * suscripción: es del padre.
     */
    accessRestricted: string
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

  // `/clientes` (issue #154): el padre crea, invita y administra clientes.
  clients: {
    title: string
    subtitle: string
    /** Aviso para Starter y Free: sin CTA de compra. */
    gateTitle: string
    gateBody: string
    createTitle: string
    createBody: string
    nameLabel: string
    namePlaceholder: string
    emailLabel: string
    emailPlaceholder: string
    maxLabel: string
    /** `{maxPages}`: el máximo del plan del padre. */
    maxHint: string
    create: string
    creating: string
    listTitle: string
    listBody: string
    empty: string
    headName: string
    headEmail: string
    headStatus: string
    headUsage: string
    headActions: string
    statusPending: string
    statusActive: string
    /** Nota bajo «Pendiente» cuando no queda invitación viva. */
    invitationCancelledNote: string
    invitationExpiredNote: string
    /** `{connected}` y `{max}`. */
    usage: string
    resend: string
    resending: string
    cancelInvitation: string
    cancelling: string
    editMax: string
    editMaxTitle: string
    editMaxBody: string
    editMaxSave: string
    editMaxSaving: string
    delete: string
    /** `{name}`. */
    deleteTitle: string
    deleteBody: string
    deleteConnectionsIntro: string
    deleteNoConnections: string
    deleteConfirm: string
    deleting: string
    invitationEmail: {
      /** `{owner}`: el nombre del padre. */
      subject: string
      preheader: string
      /** `{name}`: el nombre del cliente que escribió el padre. */
      greeting: string
      /** `{owner}`. */
      intro: string
      ctaLabel: string
      expiryNote: string
      fallbackLabel: string
      ignoreNote: string
      footerNote: string
    }
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
    // Las acciones de [Cuenta vinculada] (issue #98). Dos las impone la
    // librería y se reflejan en vez de pelearlas: `unlinkAccount` se niega a
    // quitar la última credencial (`FAILED_TO_UNLINK_LAST_ACCOUNT`) y exige
    // sesión fresca (`freshSessionMiddleware`). `oauthAccountNotLinked` es el
    // `account_not_linked` del callback cuando se vincula desde Settings.
    googleNotConfigured: string
    unlinkLastCredential: string
    sessionNotFresh: string
    linkFailed: string
    oauthAccountNotLinked: string
    conversationNotFound: string
    // Módulo Clientes (issue #154).
    clientsPlanNotAllowed: string
    clientNameRequired: string
    clientEmailAlreadyRegistered: string
    clientMaxOutOfRange: string
    clientNotFound: string
    clientInvitationNotFound: string
    clientCreated: string
    clientCreatedEmailFailed: string
    clientInvitationResent: string
    clientInvitationResentEmailFailed: string
    clientInvitationCancelled: string
    clientMaxUpdated: string
    clientDeleted: string
    // Aceptación de la invitación (ticket #156). `tooManyAttempts` es el
    // mismo límite por IP que el acceso y el alta.
    tooManyAttempts: string
    invitationNameRequired: string
    invitationExpired: string
    invitationCancelled: string
    invitationConsumed: string
    invitationUnknown: string
    invitationEmailTaken: string
    invitationSignInFailed: string
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

import type { AppDict } from "./dictionary"

// El español del producto. Es el copy que ya estaba en el JSX: la migración al
// diccionario no reescribe nada, solo lo saca de los componentes.
//
// La voz es la de la consola v2 —tuteo neutro—, no el voseo rioplatense del
// landing (`content/i18n/es.ts`). La ADR 0005 decidió que los dos conviven a
// propósito y esto no lo cambia: mueve texto de sitio, no de voz.
export const es: AppDict = {
  intl: "es-ES",

  common: {
    save: "Guardar",
    saving: "Guardando…",
    cancel: "Cancelar",
    copy: "Copiar",
    copied: "Copiado",
    dismissNotice: "Descartar el aviso",
    contactEmail: "info@resender.dev",
  },

  shell: {
    home: "Resender.dev — inicio",
    navConnections: "Conexiones",
    navInbox: "Inbox",
    navSettings: "Ajustes",
    navDocs: "Documentación",
    groupConsole: "CONSOLA",
    groupResources: "RECURSOS",
    breadcrumbConsole: "Consola",
    breadcrumbSelectPages: "Elegir páginas",
    theme: "tema",
    signOut: "Cerrar sesión",
  },

  quota: {
    warningTitle: "Te estás acercando a tu límite.",
    warningBody:
      "Llevas {usage} de los {limit} mensajes de tu plan en este período de facturación.",
    restrictedTitle: "Cuenta restringida.",
    blockedPageLimit:
      "Tu plan permite {maxPages} conexiones y tienes {activePageCount}. Desconecta conexiones para volver a enviar.",
    blockedQuota:
      "Agotaste los {limit} mensajes de tu plan en este período de facturación. Sube de plan para volver a enviar.",
    blockedPlanUnavailable:
      "No pudimos resolver los límites de tu plan. No se arregla desde tu cuenta: lo revisamos nosotros.",
    blockedDefault:
      "Tu cuenta dejó de enviar mensajes. Revisa tu suscripción para reanudarla.",
    ctaManagePages: "Administrar páginas",
    ctaContact: "Escríbenos",
    ctaUpgrade: "Subir de plan",
  },

  channels: {
    label: {
      messenger: "Messenger",
      instagram: "Instagram",
      whatsapp: "WhatsApp",
    },
    noun: {
      messenger: "esta página",
      instagram: "esta cuenta",
      whatsapp: "este número",
    },
    tokenInvalidBody: {
      messenger:
        "Meta rechazó el token de la página. Reconéctala desde Facebook para renovar permisos antes de volver a enviar respuestas.",
      instagram:
        "Meta rechazó el token de la cuenta. Vuelve a autorizarla en Instagram para renovarlo antes de seguir enviando respuestas.",
      whatsapp:
        "Meta rechazó el token del número. Vuelve a lanzar el Embedded Signup para renovarlo: mientras tanto no entra ni sale nada por este número.",
    },
    onboardingMode: {
      standard: "número nuevo (estándar)",
      coexistence: "número existente (Coexistence)",
    },
    historySync: {
      not_requested: {
        label: "historial: sin pedir",
        body: "Todavía no pedimos el historial a Meta. El plazo de 24 horas desde la conexión ya corre: si se agota sin sincronizar, hay que rehacer la conexión.",
        actionLabel: null,
      },
      requested: {
        label: "historial: pedido",
        body: "Le pedimos el historial a Meta y estamos esperando el primer bloque. No hace falta que hagas nada.",
        actionLabel: null,
      },
      in_progress: {
        label: "historial: importando",
        body: "El historial está llegando por bloques. Las conversaciones aparecen en el Inbox a medida que se importan.",
        actionLabel: null,
      },
      complete: {
        label: "historial: completo",
        body: "El import terminó. Si el negocio eligió no compartir su historial, es normal que no haya aparecido ninguna conversación vieja.",
        actionLabel: null,
      },
      failed: {
        label: "historial: falló",
        body: "No pudimos importar el historial: agotamos los reintentos contra Meta. Vuelve a lanzar el alta de Coexistence para pedirlo otra vez, mientras el plazo de 24 horas siga abierto.",
        actionLabel: "Rehacer el alta de Coexistence",
      },
      expired: {
        label: "historial: vencido",
        body: "Pasó el plazo de 24 horas y la conexión hay que rehacerla desde el Embedded Signup. Meta da de baja el onboarding cuando el historial no se sincroniza dentro de esa ventana, y no existe forma de reanudarlo.",
        actionLabel: "Rehacer desde el Embedded Signup",
      },
    },
    coexistenceLimits: [
      "Techo fijo de 20 mensajes por segundo: un número en Coexistence no escala por messaging tier, por más volumen que tenga la cuenta.",
      "La elegibilidad la decide Meta: el país, el número, la cuenta, la versión de WhatsApp Business App o el dispositivo pueden dejarlo fuera, y no hay lista publicada.",
    ],
    statusBadge: {
      active: "activa",
      "no-access": "sin acceso",
      disconnected: "desconectada",
    },
  },

  connections: {
    title: "Conexiones",
    subtitle:
      "Conecta tus páginas de Facebook, tus cuentas de Instagram y tus números de WhatsApp, configura un webhook por cuenta y desconecta canales sin borrar el historial.",
    connectFacebook: "Conectar Facebook",
    connectInstagram: "Conectar Instagram",
    connectWhatsapp: "Conectar WhatsApp",
    whatsappEntryDescription:
      "Meta abre su ventana y ahí eliges: dar de alta un número nuevo, o conectar el que ya usas en la app de WhatsApp Business. No da lo mismo cuál —cada opción deja el número de una manera distinta— y te contamos qué implica la que elijas en cuanto la ventana se cierre.",
    whatsappModeCaveat: {
      standard:
        "Diste de alta un número nuevo en la API de WhatsApp: queda registrado para la API y deja de poder usarse desde la app de WhatsApp Business.",
      coexistence:
        "Conectaste el número que ya usas en la app de WhatsApp Business: sigue funcionando ahí y además llega a Resender. Meta decide la elegibilidad y el número queda con un techo fijo de 20 mensajes por segundo. El historial hay que sincronizarlo dentro de las 24 horas siguientes.",
    },
    connectedAccountsHeading: "CUENTAS CONECTADAS",
    quotaActiveLabel: "conexiones activas",
    quotaUnresolved: "cupo sin resolver · escríbenos a info@resender.dev",
    noticeConnectedGeneric: "Conectado: la autorización se completó.",
    noticeInstagramNamed:
      "Conectado: la cuenta de Instagram @{username} quedó autorizada.",
    noticeInstagram: "Conectado: la cuenta de Instagram quedó autorizada.",
    noticeConnectedOne: "Conectado: 1 página autorizada — {list}.",
    noticeConnectedMany: "Conectado: {count} páginas autorizadas — {list}.",
    listConjunction: "y",
    empty: {
      facebookTitle: "Facebook",
      facebookBody:
        "Autoriza tus páginas desde Meta para empezar a recibir mensajes.",
      instagramTitle: "Instagram",
      instagramBody:
        "Autoriza tu cuenta profesional para recibir mensajes directos y comentarios. No necesitas una página de Facebook.",
      whatsappTitle: "WhatsApp",
      whatsappBody:
        "Da de alta un número nuevo, o conecta el que ya usas en WhatsApp Business App sin dejar de usarlo desde el teléfono. Solo se puede responder dentro de las 24 horas posteriores al último mensaje del cliente.",
      title: "Todavía no hay cuentas conectadas.",
      body: "Cuando autorices una cuenta aparecerá acá, con su webhook y su estado. Reconectar actualiza el token y los metadatos sin duplicar cuentas.",
      step1: "1 · autorizas la cuenta",
      step2: "2 · apuntas tu webhook",
      step3: "3 · llega el primer mensaje",
    },
  },

  connectionCard: {
    connectedOn: "conectada el",
    reconnect: "Reconectar",
    reconnectAgain: "Volver a conectar",
    disconnect: "Desconectar",
    tokenInvalidBadge: "token inválido",
    noAccessTitle: "El canal de {channel} no está habilitado para tu cuenta.",
    noAccessBody:
      "La conexión sigue en pie y su historial disponible, pero no recibe mensajes nuevos y no puede responder. Escríbenos a info@resender.dev para habilitarlo.",
    tokenInvalidTitle: "Hay que reconectar {noun}.",
    tokenErrorDetectedOn: "detectado el {date}",
    whatsappOnboardingLabel: "alta:",
    whatsappOnboardingUnknown: "sin registrar",
    whatsappTokenLabel: "token:",
    whatsappTokenValid: "válido",
    whatsappTokenRejected: "rechazado por Meta",
    whatsappSubscriptionLabel: "suscripción:",
    whatsappSubscriptionUnknown: "sin datos",
    coexistenceLimitsTitle: "Límites de Coexistence",
    pinTitle: "Verificación en dos pasos",
    pinBody:
      "Al registrar este número le activamos la verificación en dos pasos con un PIN que generamos nosotros. Meta no vuelve a mostrarlo: necesitas este PIN para volver a registrar el número, aquí o en cualquier otra plataforma.",
    pinReveal: "Ver PIN",
    pinRevealing: "Recuperando…",
    pinHide: "Ocultar",
    pinError: "No pudimos recuperar el PIN ahora mismo. Vuelve a intentarlo.",
    webhookLabel: "Webhook URL",
    webhookPlaceholder: "https://tu-automatizacion.example/webhook",
    webhookHint: "Cada mensaje entrante se reenvía con un POST a esta URL.",
    signingSecretLabel: "Secreto de firma",
    rotate: "Rotar",
    rotating: "Rotando…",
    generate: "Generar",
    secretRevealTitle: "Cópialo ahora: no vuelve a mostrarse.",
    secretWithBody:
      "Cada POST lleva las cabeceras resender-signature, resender-event-id y resender-timestamp. Rotar invalida el secreto anterior.",
    secretWithoutBody:
      "Todavía sin firma: el receptor no puede verificar que el POST venga de Resender.",
    disconnectedOn: "Desconectada el {date}. ",
    disconnectedNoDate: "Desconectada. ",
    disconnectedHistoryKept:
      "El historial sigue disponible en el log de mensajes.",
    disconnectTitle: "¿Desconectar {name}?",
    disconnectBody:
      "Dejará de recibir tráfico nuevo, pero el historial se conserva. Puedes volver a conectarla más adelante.",
    disconnectConfirm: "Sí, desconectar",
    disconnecting: "Desconectando…",
  },

  select: {
    title: "Elegir páginas",
    subtitle:
      "Elige cuáles de las páginas que administras en Facebook quieres conectar a Resender.",
    back: "Volver a Conexiones sin conectar nada",
    noAuthTitle: "Todavía no autorizaste tus páginas en Meta.",
    noAuthBody:
      "Necesitamos tu autorización para listar las páginas que administras. Conecta Facebook y vuelves acá a elegir cuáles conectar.",
    planUnresolvedTitle: "No pudimos resolver los límites de tu plan.",
    planUnresolvedBody:
      "Escríbenos a info@resender.dev para revisar tu suscripción antes de conectar páginas.",
    planHeading: "Tu plan",
    planUsage: "Tienes {activePageCount} de {maxPages} conexiones.",
    allowanceOne: "Puedes añadir {count} página más.",
    allowanceMany: "Puedes añadir {count} páginas más.",
    allowanceNone:
      "No te queda cupo: desconecta una página para liberar cupo y conectar otra.",
    emptyTitle: "Todavía no hay páginas que puedas conectar.",
    emptyBody:
      "Meta no devolvió ninguna página que administres. Revisa que le hayas dado acceso a tus páginas y vuelve a conectar Facebook.",
    listHeading: "PÁGINAS QUE ADMINISTRAS",
    badgeConnected: "ya conectada",
    badgeForeign: "en otra cuenta",
    badgeAtLimit: "Ya marcaste la que te permite tu plan",
    foreignBody:
      "Ya está conectada en otra cuenta de Resender. Una página pertenece a una sola cuenta.",
    connectedBody: "Ya la tienes conectada y activa.",
    addOnlyHint:
      "Esta pantalla solo agrega páginas: desmarcar una página conectada nunca la desconecta.",
    atLimitHint:
      "Ya marcaste las {remainingSlots} que te permite tu plan ({maxPages} conexiones en total). Desmarca una para elegir otra, o desconecta una para liberar cupo.",
    submit: "Conectar las páginas elegidas",
    submitting: "Conectando…",
  },

  inbox: {
    title: "Inbox",
    subtitle:
      "Log durable de mensajes y comentarios. Las respuestas salen de la API externa; esta pantalla es de solo lectura.",
    tabs: { mensajes: "Mensajes", comentarios: "Comentarios" },
    tabsAria: "Modo de la bandeja",
    countTitle: {
      mensajes: "Conversaciones en el log",
      comentarios: "Publicaciones con comentarios",
    },
    filterAll: "Todas las cuentas",
    filterAria: "Filtrar por cuenta",
    conversationsHeading: "Conversaciones",
    publicationsHeading: "Publicaciones",
    emptyConversations: "Todavía no hay conversaciones.",
    emptyConversationsFiltered: "No hay conversaciones para este filtro.",
    emptyComments: "Todavía no hay comentarios.",
    emptyCommentsFiltered: "No hay comentarios para este filtro.",
    readOnly: "solo lectura",
    readOnlyHint: "Las respuestas salen por la API externa",
    threadEmpty: "Esta conversación todavía no tiene mensajes guardados.",
    noConversationsTitle: "Todavía no hay conversaciones guardadas.",
    noConversationsFilteredTitle:
      "Esta cuenta todavía no tiene conversaciones.",
    noConversationsBody:
      "Cuando alguien escriba a esta cuenta, el mensaje se guarda acá y se reenvía a tu webhook.",
    noConversationsFilteredBody:
      "El filtro no devolvió ninguna conversación. Prueba con «Todas las cuentas» para ver el resto del log.",
    noCommentsTitle: "Todavía no hay comentarios guardados.",
    noCommentsFilteredTitle: "Esta cuenta todavía no tiene comentarios.",
    noCommentsBody:
      "Cuando alguien comente una publicación, el comentario se guarda acá y se reenvía a tu webhook.",
    noCommentsFilteredBody:
      "El filtro no devolvió ninguna publicación. Prueba con «Todas las cuentas» para ver el resto del log.",
    noInstagramTitle: "Todavía no hay ninguna cuenta de Instagram conectada.",
    noInstagramBody:
      "Los comentarios llegan solo por Instagram. Conecta una cuenta profesional para verlos acá.",
    noInstagramCta: "Ir a Conexiones",
    openInInstagram: "Abrir en Instagram",
    fromCommentTitle:
      "Salió como respuesta privada a un comentario de Instagram",
    deliveryTitle:
      "Lo que reporta Meta sobre la entrega, distinto del estado interno del envío",
    reactionOutbound: "Reacción del negocio",
    reactionInbound: "Reacción del contacto",
    imageAlt: "Adjunto de imagen",
    attachmentStatus: {
      pending: "descargando…",
      available: "preview / descarga",
      failed: "no se pudo descargar",
      deleted: "archivo expirado",
      unavailable: "WhatsApp no conserva archivos de más de 14 días",
    },
  },

  log: {
    today: "hoy {time}",
    yesterday: "ayer {time}",
    you: "Tú: ",
    noMessages: "Todavía no hay mensajes.",
    deliveryPrefix: "entrega: {status}",
    delivery: {
      accepted: "aceptado",
      sent: "enviado",
      delivered: "entregado",
      read: "leído",
      failed: "no entregado",
      deleted: "eliminado",
    },
    fromCommentSuffix: "respuesta a comentario",
    replyingTo: "respondiendo a {author}",
    commentCountOne: "1 comentario",
    commentCountMany: "{count} comentarios",
    mediaNouns: {
      feed: "publicación",
      reels: "reel",
      story: "historia",
      ad: "anuncio",
    },
  },

  settings: {
    title: "Ajustes",
    subtitle: "Administra tu cuenta y las API keys de integración externa.",
    tabs: {
      cuenta: "Cuenta",
      "api-keys": "API keys",
      suscripcion: "Suscripción",
    },
    tabsAria: "Secciones de ajustes",
    language: {
      title: "Idioma",
      body: "El idioma de la consola. No cambia el idioma de la API ni el de los correos de Meta.",
      label: "Idioma de la consola",
      es: "Español",
      en: "English",
    },
  },

  account: {
    title: "Cuenta",
    emailLabel: "email",
    tenantIdLabel: "tenant_id",
    copyTenantId: "Copiar el identificador de cuenta",
    passwordTitle: "Cambiar contraseña",
    passwordBody:
      "Define una contraseña nueva. Al guardarla cerramos tu sesión y tendrás que iniciar de nuevo.",
    newPassword: "Contraseña nueva",
    newPasswordPlaceholder: "Al menos 8 caracteres",
    confirmPassword: "Repetir contraseña",
    confirmPasswordPlaceholder: "Repite la contraseña nueva",
    passwordHint: "Mínimo 8 caracteres.",
    passwordSubmit: "Cambiar contraseña",
    deleteTitle: "Eliminar cuenta",
    deleteBody:
      "Borra definitivamente tu cuenta y todos tus datos: páginas conectadas, conversaciones, mensajes y API keys. Antes de borrar intentamos desuscribir tus páginas del webhook de Meta. Es inmediato y no se puede deshacer; las copias de respaldo se purgan en 30 días.",
    deleteCta: "Eliminar cuenta",
    deleteDialogTitle: "Eliminar tu cuenta",
    deleteDialogBody:
      "Se borran tu cuenta, tus páginas conectadas, tus conversaciones, tus mensajes y tus API keys. Es inmediato y no se puede deshacer.",
    deleteConfirmBefore: "Escribe ",
    deleteConfirmAfter: " para confirmar",
    deleteConfirm: "Sí, eliminar mi cuenta",
    deleting: "Eliminando…",
    signInMethods: {
      title: "Cómo entras a Resender",
      body: "Cada forma de entrar es independiente: vincular Google no borra tu contraseña.",
      emailUnverified: "Correo sin confirmar",
      emailUnverifiedHint: "Confírmalo para poder vincular Google.",
      resend: "Reenviar confirmación",
      resendSent: "Listo, te lo reenviamos.",
      password: "Contraseña",
      passwordConfigured: "Configurada",
      passwordMissing: "Sin configurar",
      google: "Google",
      googleNotLinked: "No vinculado",
      link: "Vincular",
      change: "Cambiar",
      linkRequiresVerified: "Confirma tu correo primero",
      unlink: "Desvincular",
      unlinkHint: "Desvincular pide una sesión reciente.",
      lastCredentialHint: "Es tu única forma de entrar; no se puede quitar.",
      linked: "Vinculado",
    },
  },

  apiKeys: {
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
    listBody:
      "Revocar es inmediato: las llamadas con esa key empiezan a fallar.",
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
  },

  subscription: {
    title: "Suscripción",
    none: "sin suscripción",
    noneBody: "No hay ninguna suscripción registrada para esta cuenta.",
    choosePlan: "Elegir un plan",
    planLabel: "plan",
    renewsLabel: "renueva",
    cancelsLabel: "cancela",
    connectionsLabel: "conexiones",
    perMonth: " · ${price} / mes",
    periodMessages: "Mensajes de este período",
    usageAria: "Consumo de mensajes del período",
    usageNeutral:
      "Desde el 80 % te avisamos; al agotar la cuota se pausa el envío hasta el próximo período.",
    usageWarning:
      "Estás al {percent} %. Desde el 80 % te avisamos; al agotar la cuota se pausa el envío hasta el próximo período.",
    usageBlocked:
      "Agotaste la cuota: el envío queda pausado hasta el próximo período. Sube de plan para reanudarlo.",
    limitsUnresolved:
      "No pudimos resolver los límites de tu plan, así que no podemos mostrarte el consumo. Escríbenos a",
    managePortal: "Administrar suscripción",
    portalHint:
      "Cambia de plan, actualiza tu método de pago o cancela en el portal de clientes de Stripe.",
  },

  accessPending: {
    eyebrow: "acceso",
    title: "Ya estás dentro.",
    body: "Tu cuenta quedó creada y tu lugar en la lista guardado. Estamos abriendo el acceso de a poco, cuenta por cuenta: te escribimos en cuanto te toque y no tienes que hacer nada más.",
    emailLabel: "Te escribimos a",
    helpBefore: "Mientras tanto puedes leer la ",
    helpDocsLink: "documentación",
    helpMiddle: " o escribirnos a ",
    helpAfter: ".",
    signOut: "Cerrar sesión",
    verify: {
      title: "Confirma tu correo",
      body: "Te escribimos a {email} para confirmar que es tuyo. No hace falta para esperar la aprobación, pero sí para entrar con Google.",
      resend: "Reenviar confirmación",
      sent: "Listo, te lo reenviamos.",
      linkExpired: "El enlace venció, pide uno nuevo.",
    },
  },

  billing: {
    metaTitle: "Suscripción",
    eyebrow: "pricing",
    title: "Elige tu plan.",
    subtitle:
      "Tu cuenta está aprobada. El pago ocurre en una página segura de Stripe.",
    signOut: "Cerrar sesión",
    perMonth: "/ mes",
    planLimitsOne: "{messages} mensajes · {pages} conexión",
    planLimitsMany: "{messages} mensajes · {pages} conexiones",
    subscribe: "Suscribirme",
    recommended: "Recomendado",
    footnote:
      "Cambia de plan, actualiza tu tarjeta o cancela cuando quieras desde Ajustes, con el portal de Stripe.",
    successMetaTitle: "Activando tu suscripción",
    successTitle: "Activando tu suscripción…",
    successBody:
      "Gracias por suscribirte. Estamos confirmando el pago con Stripe: suele tomar unos segundos y esta página te lleva adentro sola. No hace falta que recargues ni que vuelvas a pagar.",
    successSlowBefore: "¿Tarda más de lo esperado? ",
    successSlowLink: "Abre la app",
    successSlowMiddle: " o escríbenos a ",
    successSlowAfter: ".",
    successCta: "Ir a mis conexiones",
  },

  metaErrors: {
    prefix: "No se pudo conectar",
    unknown: "No se pudo conectar: {reason}.",
    empty: "No se pudo conectar.",
    webhookSubscriptionFailed:
      "No se pudo conectar: Meta no confirmó la suscripción al webhook de todas las páginas. Ninguna página quedó guardada.",
    pageOwned:
      "No se pudo conectar: la página {id} ya pertenece a otra cuenta de Resender.",
    configurationFailed:
      "No se pudo conectar: el cifrado de secretos del servidor no está configurado.",
    metaSessionExpired:
      "No se pudo conectar: tu autorización de Meta venció. Vuelve a conectar Facebook.",
    stateMismatch:
      "No se pudo conectar: la sesión de autorización venció o no coincide. Inténtalo de nuevo.",
    instagramNotEnabled:
      "No se pudo conectar: el canal de Instagram no está habilitado para tu cuenta.",
    instagramPageLimitReached:
      "No se pudo conectar: el cupo de conexiones de tu plan está completo. Desconecta una conexión en Conexiones para liberar cupo.",
    instagramExchangeFailed:
      "No se pudo conectar: Instagram no completó el intercambio de credenciales. Vuelve a intentarlo.",
    instagramProfileFailed:
      "No se pudo conectar: Instagram autorizó la cuenta pero no devolvió su perfil. Revisa que sea una cuenta profesional y vuelve a intentarlo.",
    instagramSubscriptionFailed:
      "No se pudo conectar: Instagram no confirmó la suscripción al webhook. La cuenta no quedó conectada.",
    instagramAccountOwned:
      "No se pudo conectar: la cuenta de Instagram {id} ya pertenece a otra cuenta de Resender.",
    whatsappNotEnabled:
      "No se pudo conectar: el canal de WhatsApp no está habilitado para tu cuenta.",
    whatsappPageLimitReached:
      "No se pudo conectar: el cupo de conexiones de tu plan está completo. Desconecta una conexión en Conexiones para liberar cupo.",
    whatsappExchangeFailed:
      "No se pudo conectar: Meta no completó el intercambio de credenciales de WhatsApp. Vuelve a intentarlo.",
    whatsappAssetsFailed:
      "No se pudo conectar: la autorización no incluyó el número ni la cuenta de WhatsApp Business. Vuelve a lanzarla y elige el número que quieres conectar.",
    whatsappRegisterFailed:
      "No se pudo conectar: Meta no pudo registrar el número en Cloud API. Revisa que no esté en uso en otra plataforma y vuelve a intentarlo.",
    whatsappSubscribeFailed:
      "No se pudo conectar: Meta no confirmó la suscripción al webhook de la cuenta de WhatsApp Business. El número no quedó conectado.",
    whatsappSyncRequestFailed:
      "No se pudo conectar: el número quedó conectado pero no pudimos pedirle el historial a Meta. El plazo de 24 horas ya corre: vuelve a lanzar el alta de Coexistence para pedirlo otra vez.",
    whatsappStateMismatch:
      "No se pudo conectar: la autorización no coincide con esta pestaña. Suele pasar cuando Conexiones quedó abierta en otra pestaña o ventana, porque la segunda invalida la conexión que empezó la primera. Cierra las demás y vuelve a lanzarla desde una sola.",
    whatsappPinRequired:
      "No se pudo conectar: el número ya tiene la verificación en dos pasos activada. Vuelve a lanzar la conexión indicando su PIN de seis dígitos, o desactívala desde WhatsApp Manager e inténtalo de nuevo.",
    whatsappPersistFailed:
      "No se pudo conectar: el número se autorizó en Meta pero no se pudo guardar. Vuelve a intentarlo; si se repite, escríbenos.",
    whatsappNumberOwned:
      "No se pudo conectar: el número de WhatsApp {id} ya pertenece a otra cuenta de Resender.",
  },

  actions: {
    notSignedIn: "No has iniciado sesión.",
    waitlisted: "Tu cuenta está en la lista de espera.",
    noSubscription: "Tu suscripción no está activa.",
    invalidPage: "Página inválida.",
    pageNotFound: "No encontramos esa página.",
    invalidApiKey: "La API key no es válida.",
    apiKeyNotFound: "No encontramos la API key.",
    apiKeyLabelRequired: "Escribe una etiqueta para la key.",
    apiKeyLabelTooLong: "La etiqueta no puede pasar de 80 caracteres.",
    apiKeyRevealed: "Copia la key ahora: no vamos a volver a mostrarla.",
    accountNotFound: "No encontramos la cuenta.",
    confirmEmailMismatch:
      "El email no coincide. Escribe tu email exacto para confirmar.",
    deletePrepareFailed:
      "No pudimos preparar el borrado. Vuelve a intentarlo en un minuto.",
    invalidEmail: "Escribe un email válido.",
    passwordTooShort: "La contraseña debe tener al menos 8 caracteres.",
    passwordsDoNotMatch: "Las contraseñas no coinciden.",
    selectOnePage: "Elige al menos una página.",
    selectOneNewPage: "Elige al menos una página nueva para conectar.",
    planUnresolved:
      "No pudimos resolver los límites de tu plan. Escríbenos a info@resender.dev.",
    quotaCheckFailed:
      "No pudimos comprobar el cupo de tu plan ahora mismo. Vuelve a intentarlo en un momento.",
    connectFailed:
      "No se pudo conectar: hubo un problema con las páginas seleccionadas. Inténtalo de nuevo.",
    disconnected: "Página desconectada. El historial se conserva.",
    secretRotated: "Secreto rotado. Cópialo ahora: no vuelve a mostrarse.",
    webhookUpdated: "Webhook actualizado.",
    webhookUpdatedWithSecret: "Webhook actualizado. Copia el secreto de firma:",
    webhookUrlNotHttps:
      "La URL tiene que usar https. Solo se permite http en localhost, para desarrollo.",
    webhookUrlInvalid: "Escribe una URL válida.",
    whatsappNotEnabled:
      "El canal de WhatsApp no está habilitado para tu cuenta.",
    whatsappNoPin:
      "Este número no tiene un PIN generado por Resender. Si lo elegiste tú, revísalo en WhatsApp Manager.",
    accountSlotFull:
      "Tu plan permite {maxPages} conexiones y ya tienes {activePageCount} activas. Desconecta una en Conexiones para liberar un hueco y vuelve a lanzar la conexión.",
    invalidSelection:
      "Esa selección incluye una página que no puedes conectar. Recarga la pantalla e inténtalo de nuevo.",
    pageLimitPlan:
      "Tu plan permite {maxPages} conexiones y ya tienes {activePageCount} activas",
    pageLimitNone:
      ": no te queda cupo. Desconecta una página para liberar cupo y conectar otra.",
    pageLimitRemainingOne:
      ": puedes añadir {remainingSlots} página más. Desmarca las que sobren o desconecta una página para liberar cupo.",
    pageLimitRemainingMany:
      ": puedes añadir {remainingSlots} páginas más. Desmarca las que sobren o desconecta una página para liberar cupo.",
    googleNotConfigured: "Entrar con Google no está disponible ahora mismo.",
    unlinkLastCredential: "No puedes quitar tu única forma de entrar.",
    sessionNotFresh: "Para desvincular, cierra sesión y vuelve a entrar.",
    linkFailed: "No pudimos vincular Google. Inténtalo de nuevo.",
    oauthAccountNotLinked:
      "No se vinculó: confirma tu correo primero y vuelve a intentarlo.",
  },

  whatsappEvents: {
    finishedWithoutNumber:
      "Terminaste sin agregar un número: la cuenta de WhatsApp Business quedó lista, pero Resender necesita un número para recibir mensajes. Vuelve a lanzar la conexión y completa el paso del teléfono.",
    flowError:
      "Meta cortó la conexión con un error y no se conectó ningún número. Vuelve a intentarlo en unos minutos; si se repite, escríbenos a info@resender.dev.",
    malformed:
      "Meta devolvió una respuesta incompleta y no se conectó ningún número. Vuelve a lanzar la conexión.",
    reportedError: "Meta rechazó la conexión: {message}{suffix}",
    reportedErrorCode: "código {code}",
    reportedErrorSession: "sesión {id}",
    reportedErrorSuffix: " ({reference} — cítalos si escribes a soporte).",
    abandoned:
      "Cerraste la ventana de Meta antes de terminar, así que no se conectó ningún número.{where} Puedes volver a lanzarla cuando quieras.",
    abandonedWhere: " Te quedaste en {step}.",
    unsupportedMigration:
      "Completaste una migración desde otro proveedor. Ese flujo todavía no está soportado en Resender: escríbenos a info@resender.dev y lo hacemos contigo.",
    unsupportedGrantOnly:
      "Solo diste acceso a la API, sin conectar un número. Vuelve a lanzar la conexión y completa el flujo hasta elegir el teléfono.",
    unsupportedOther:
      "Meta terminó el flujo en una variante que Resender todavía no soporta ({event}). No se conectó ningún número; escríbenos a info@resender.dev.",
    steps: {
      BUSINESS_ACCOUNT_SELECTION: "la selección del portafolio de negocio",
      WABA_PHONE_PROFILE_PICKER:
        "la selección de la cuenta de WhatsApp Business",
      WHATSAPP_BUSINESS_PROFILE_SETUP:
        "la creación de la cuenta de WhatsApp Business",
      PHONE_NUMBER_SETUP: "el alta del número de teléfono",
      PHONE_NUMBER_VERIFICATION: "la verificación del número",
      PERMISSIONS: "la revisión de permisos",
    },
  },

  whatsappSignup: {
    connect: "Conectar WhatsApp",
    connecting: "Conectando…",
    description:
      "Meta abre su ventana y ahí eliges: dar de alta un número nuevo, o conectar el que ya usas en la app de WhatsApp Business. No da lo mismo cuál —cada opción deja el número de una manera distinta— y te contamos qué implica la que elijas en cuanto la ventana se cierre.",
    preparing: "Preparando la conexión con Meta…",
    nonceFailed:
      "No se pudo preparar la conexión con WhatsApp. Recarga la página e inténtalo de nuevo.",
    submitFailed:
      "No se pudo conectar. Vuelve a intentarlo; si se repite, escríbenos a info@resender.dev.",
    networkFailed:
      "No pudimos hablar con el servidor para terminar la conexión. Revisa tu conexión y vuelve a lanzarla.",
    pairingIncomplete:
      "La autorización de Meta volvió incompleta y no se conectó ningún número. Vuelve a lanzarla; si se repite, escríbenos a info@resender.dev.",
    sdkBlocked:
      "No se pudo cargar el SDK de Facebook, que es lo que abre la ventana de Meta. Suele ser un bloqueador de anuncios o de rastreadores: permítelo para este sitio y recarga la página.",
    popupClosed:
      "La ventana de Meta se cerró sin completar la autorización, así que no se conectó ningún número. Si no llegaste a verla, permite las ventanas emergentes para este sitio y vuelve a intentarlo.",
    notConfigured:
      "Conectar WhatsApp no está disponible en este despliegue: falta configurar NEXT_PUBLIC_WHATSAPP_CONFIG_ID. Escríbenos a info@resender.dev.",
    pinLabel: "PIN de verificación en dos pasos",
    pinPlaceholder: "6 dígitos",
    pinHint: "Escribe el PIN actual del número y vuelve a lanzar la conexión.",
  },
}

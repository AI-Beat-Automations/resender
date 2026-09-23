/** Lo que devuelven las server actions del producto. */
export type ActionsDict = {
  notSignedIn: string
  waitlisted: string
  emailUnverified: string
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

export const es: ActionsDict = {
  notSignedIn: "No has iniciado sesión.",
  waitlisted: "Tu cuenta está en la lista de espera.",
  emailUnverified: "Confirma tu correo antes de conectar una red.",
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
  whatsappNotEnabled: "El canal de WhatsApp no está habilitado para tu cuenta.",
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
  conversationNotFound: "No encontramos esa conversación.",
  clientsPlanNotAllowed:
    "Clientes está disponible en los planes Pro y Business.",
  clientNameRequired: "Escribe el nombre del cliente.",
  clientEmailAlreadyRegistered:
    "Ese correo ya tiene una cuenta en Resender o una invitación pendiente. Usa otro correo.",
  clientMaxOutOfRange:
    "El tope de conexiones tiene que estar entre 1 y {maxPages}.",
  clientNotFound: "No encontramos ese cliente.",
  clientInvitationNotFound: "Ese cliente no tiene una invitación pendiente.",
  clientCreated: "Cliente creado. Le enviamos la invitación a {email}.",
  clientCreatedEmailFailed:
    "Cliente creado, pero no pudimos enviar la invitación. Reenvíala desde la lista.",
  clientInvitationResent: "Invitación reenviada a {email}.",
  clientInvitationResentEmailFailed:
    "No pudimos enviar la invitación. Vuelve a intentarlo en un minuto.",
  clientInvitationCancelled: "Invitación cancelada.",
  clientMaxUpdated: "Tope actualizado.",
  clientDeleted: "Cliente eliminado.",
  tooManyAttempts: "Demasiados intentos. Espera un minuto y vuelve a probar.",
  invitationNameRequired: "Escribe tu nombre.",
  invitationExpired:
    "Este enlace venció. Pídele a quien te invitó que te lo reenvíe.",
  invitationCancelled:
    "Esta invitación se canceló. Pídele a quien te invitó una nueva.",
  invitationConsumed:
    "Este enlace ya se usó. Entra con tu correo y tu contraseña.",
  invitationUnknown: "Este enlace no es válido.",
  invitationEmailTaken:
    "Ese correo ya tiene una cuenta en Resender. Entra con tu contraseña o recupérala desde el acceso.",
  invitationSignInFailed:
    "Tu acceso quedó creado, pero no pudimos iniciar tu sesión. Entra con tu correo y tu contraseña.",
}

export const en: ActionsDict = {
  notSignedIn: "You're not signed in.",
  waitlisted: "Your account is on the waitlist.",
  emailUnverified: "Confirm your email before connecting a network.",
  invalidPage: "Invalid page.",
  pageNotFound: "We couldn't find that page.",
  invalidApiKey: "That API key isn't valid.",
  apiKeyNotFound: "We couldn't find that API key.",
  apiKeyLabelRequired: "Enter a label for the key.",
  apiKeyLabelTooLong: "The label can't be longer than 80 characters.",
  apiKeyRevealed: "Copy the key now: we won't show it again.",
  accountNotFound: "We couldn't find the account.",
  confirmEmailMismatch:
    "The email doesn't match. Type your exact email to confirm.",
  deletePrepareFailed:
    "We couldn't prepare the deletion. Please try again in a minute.",
  invalidEmail: "Enter a valid email.",
  passwordTooShort: "The password must be at least 8 characters.",
  passwordsDoNotMatch: "The passwords don't match.",
  selectOnePage: "Pick at least one page.",
  selectOneNewPage: "Pick at least one new page to connect.",
  planUnresolved:
    "We couldn't resolve your plan's limits. Write to info@resender.dev.",
  quotaCheckFailed:
    "We couldn't check your plan's quota right now. Please try again in a moment.",
  connectFailed:
    "Couldn't connect: something went wrong with the selected pages. Please try again.",
  disconnected: "Page disconnected. The history is kept.",
  secretRotated: "Secret rotated. Copy it now: it won't be shown again.",
  webhookUpdated: "Webhook updated.",
  webhookUpdatedWithSecret: "Webhook updated. Copy the signing secret:",
  webhookUrlNotHttps:
    "The URL has to use https. http is only allowed on localhost, for development.",
  webhookUrlInvalid: "Enter a valid URL.",
  whatsappNotEnabled: "The WhatsApp channel isn't enabled for your account.",
  whatsappNoPin:
    "This number doesn't have a PIN generated by Resender. If you chose it yourself, check it in WhatsApp Manager.",
  accountSlotFull:
    "Your plan allows {maxPages} connections and you already have {activePageCount} active. Disconnect one in Connections to free up a slot and run the connection again.",
  invalidSelection:
    "That selection includes a page you can't connect. Reload the screen and try again.",
  pageLimitPlan:
    "Your plan allows {maxPages} connections and you already have {activePageCount} active",
  pageLimitNone:
    ": you're out of quota. Disconnect a page to free up a slot and connect another one.",
  pageLimitRemainingOne:
    ": you can add {remainingSlots} more page. Uncheck the extra ones, or disconnect a page to free up a slot.",
  pageLimitRemainingMany:
    ": you can add {remainingSlots} more pages. Uncheck the extra ones, or disconnect a page to free up a slot.",
  googleNotConfigured: "Signing in with Google isn't available right now.",
  unlinkLastCredential: "You can't remove your only way in.",
  sessionNotFresh: "To unlink, sign out and sign in again.",
  linkFailed: "We couldn't link Google. Try again.",
  oauthAccountNotLinked:
    "It wasn't linked: confirm your email first and try again.",
  conversationNotFound: "We couldn't find that conversation.",
  clientsPlanNotAllowed: "Clients is available on the Pro and Business plans.",
  clientNameRequired: "Type the client's name.",
  clientEmailAlreadyRegistered:
    "That email already has a Resender account or a pending invitation. Use a different one.",
  clientMaxOutOfRange: "The connection limit must be between 1 and {maxPages}.",
  clientNotFound: "We couldn't find that client.",
  clientInvitationNotFound: "That client has no pending invitation.",
  clientCreated: "Client created. We sent the invitation to {email}.",
  clientCreatedEmailFailed:
    "Client created, but we couldn't send the invitation. Resend it from the list.",
  clientInvitationResent: "Invitation resent to {email}.",
  clientInvitationResentEmailFailed:
    "We couldn't send the invitation. Try again in a minute.",
  clientInvitationCancelled: "Invitation cancelled.",
  clientMaxUpdated: "Limit updated.",
  clientDeleted: "Client deleted.",
  tooManyAttempts: "Too many attempts. Wait a minute and try again.",
  invitationNameRequired: "Enter your name.",
  invitationExpired:
    "This link has expired. Ask the person who invited you to resend it.",
  invitationCancelled:
    "This invitation was cancelled. Ask the person who invited you for a new one.",
  invitationConsumed:
    "This link was already used. Sign in with your email and password.",
  invitationUnknown: "This link is not valid.",
  invitationEmailTaken:
    "That email already has a Resender account. Sign in with your password or recover it from the sign-in page.",
  invitationSignInFailed:
    "Your access was created, but we couldn't start your session. Sign in with your email and password.",
}

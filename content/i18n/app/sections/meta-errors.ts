/**
 * Motivos de fallo del callback de Meta. Las claves son los `reason` del
 * querystring; los tres `*_owned` llevan el id interpolado en `{id}`.
 * `whatsappPaymentMethod` es la excepción: no sale del callback sino de un
 * envío o acuse con el código 131042, y lo muestra la bitácora.
 */
export type MetaErrorsDict = {
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
  /** 131042: la WABA no tiene un método de pago válido (ADR 0023). */
  whatsappPaymentMethod: string
  whatsappPaymentLink: string
}

export const es: MetaErrorsDict = {
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
  whatsappPaymentMethod:
    "Meta no entregó el mensaje porque tu cuenta de WhatsApp Business no tiene un método de pago válido. Meta cobra los mensajes de WhatsApp directo a la tarjeta de esa cuenta, no a través de Resender: agrega o corrige el método de pago en la configuración de pagos de Meta Business y vuelve a enviar.",
  whatsappPaymentLink: "Abrir la configuración de pagos de Meta",
}

export const en: MetaErrorsDict = {
  prefix: "Couldn't connect",
  unknown: "Couldn't connect: {reason}.",
  empty: "Couldn't connect.",
  webhookSubscriptionFailed:
    "Couldn't connect: Meta didn't confirm the webhook subscription for every page. No page was saved.",
  pageOwned:
    "Couldn't connect: page {id} already belongs to another Resender account.",
  configurationFailed:
    "Couldn't connect: the server's secret encryption isn't configured.",
  metaSessionExpired:
    "Couldn't connect: your Meta authorization expired. Connect Facebook again.",
  stateMismatch:
    "Couldn't connect: the authorization session expired or doesn't match. Please try again.",
  instagramNotEnabled:
    "Couldn't connect: the Instagram channel isn't enabled for your account.",
  instagramPageLimitReached:
    "Couldn't connect: your plan's connection quota is full. Disconnect a connection in Connections to free up a slot.",
  instagramExchangeFailed:
    "Couldn't connect: Instagram didn't complete the credential exchange. Please try again.",
  instagramProfileFailed:
    "Couldn't connect: Instagram authorized the account but didn't return its profile. Check that it's a professional account and try again.",
  instagramSubscriptionFailed:
    "Couldn't connect: Instagram didn't confirm the webhook subscription. The account wasn't connected.",
  instagramAccountOwned:
    "Couldn't connect: the Instagram account {id} already belongs to another Resender account.",
  whatsappNotEnabled:
    "Couldn't connect: the WhatsApp channel isn't enabled for your account.",
  whatsappPageLimitReached:
    "Couldn't connect: your plan's connection quota is full. Disconnect a connection in Connections to free up a slot.",
  whatsappExchangeFailed:
    "Couldn't connect: Meta didn't complete the WhatsApp credential exchange. Please try again.",
  whatsappAssetsFailed:
    "Couldn't connect: the authorization didn't include the number or the WhatsApp Business account. Run it again and pick the number you want to connect.",
  whatsappRegisterFailed:
    "Couldn't connect: Meta couldn't register the number on the Cloud API. Check that it isn't in use on another platform and try again.",
  whatsappSubscribeFailed:
    "Couldn't connect: Meta didn't confirm the webhook subscription for the WhatsApp Business account. The number wasn't connected.",
  whatsappSyncRequestFailed:
    "Couldn't connect: the number was connected but we couldn't request its history from Meta. The 24-hour window is already running: run the Coexistence signup again to request it once more.",
  whatsappStateMismatch:
    "Couldn't connect: the authorization doesn't match this tab. This usually happens when Connections was left open in another tab or window, because the second one invalidates the connection the first one started. Close the others and run it again from a single one.",
  whatsappPinRequired:
    "Couldn't connect: the number already has two-step verification turned on. Run the connection again providing its six-digit PIN, or turn it off from WhatsApp Manager and try again.",
  whatsappPersistFailed:
    "Couldn't connect: the number was authorized on Meta but couldn't be saved. Please try again; if it keeps happening, write to us.",
  whatsappNumberOwned:
    "Couldn't connect: the WhatsApp number {id} already belongs to another Resender account.",
  whatsappPaymentMethod:
    "Meta didn't deliver the message because your WhatsApp Business account has no valid payment method. Meta bills WhatsApp messages directly to that account's card, not through Resender: add or fix the payment method in Meta Business payment settings and send again.",
  whatsappPaymentLink: "Open Meta payment settings",
}

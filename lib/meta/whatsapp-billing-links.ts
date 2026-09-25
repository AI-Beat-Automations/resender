// Enlaces a Meta para el cobro de WhatsApp (ADR 0023). Meta le factura cada
// mensaje cobrado al cliente, a la tarjeta de su WABA; Resender solo informa y
// manda a estas dos páginas. Viven juntos para que el copy de marketing, el
// alta de WhatsApp, la bitácora y el error 131042 de la API apunten a lo mismo.

/** Tarifas oficiales de WhatsApp Business Platform. */
export const META_WHATSAPP_PRICING_URL =
  "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing"

/** Configuración de pagos de Meta Business, donde se registra la tarjeta. */
export const META_PAYMENT_SETTINGS_URL =
  "https://business.facebook.com/billing_hub/payment_settings"

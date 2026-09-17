/**
 * Cómo se le cuenta al usuario cada desenlace del popup de Meta. Los `steps`
 * son los `current_step` de Meta —claves suyas, no nuestras— traducidos a la
 * voz de la pantalla; un valor que Meta agregue cae fuera del mapa y el
 * mensaje simplemente omite el «te quedaste en…».
 */
export type WhatsappEventsDict = {
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

export const es: WhatsappEventsDict = {
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
    WABA_PHONE_PROFILE_PICKER: "la selección de la cuenta de WhatsApp Business",
    WHATSAPP_BUSINESS_PROFILE_SETUP:
      "la creación de la cuenta de WhatsApp Business",
    PHONE_NUMBER_SETUP: "el alta del número de teléfono",
    PHONE_NUMBER_VERIFICATION: "la verificación del número",
    PERMISSIONS: "la revisión de permisos",
  },
}

export const en: WhatsappEventsDict = {
  finishedWithoutNumber:
    "You finished without adding a number: the WhatsApp Business account is ready, but Resender needs a number to receive messages. Run the connection again and complete the phone step.",
  flowError:
    "Meta cut the connection with an error and no number was connected. Try again in a few minutes; if it keeps happening, write to info@resender.dev.",
  malformed:
    "Meta returned an incomplete response and no number was connected. Run the connection again.",
  reportedError: "Meta rejected the connection: {message}{suffix}",
  reportedErrorCode: "code {code}",
  reportedErrorSession: "session {id}",
  reportedErrorSuffix: " ({reference} — quote them if you contact support).",
  abandoned:
    "You closed Meta's window before finishing, so no number was connected.{where} You can run it again whenever you want.",
  abandonedWhere: " You stopped at {step}.",
  unsupportedMigration:
    "You completed a migration from another provider. That flow isn't supported in Resender yet: write to info@resender.dev and we'll do it with you.",
  unsupportedGrantOnly:
    "You only granted API access, without connecting a number. Run the connection again and complete the flow up to picking the phone.",
  unsupportedOther:
    "Meta finished the flow in a variant that Resender doesn't support yet ({event}). No number was connected; write to info@resender.dev.",
  steps: {
    BUSINESS_ACCOUNT_SELECTION: "the business portfolio selection",
    WABA_PHONE_PROFILE_PICKER: "the WhatsApp Business account selection",
    WHATSAPP_BUSINESS_PROFILE_SETUP: "creating the WhatsApp Business account",
    PHONE_NUMBER_SETUP: "the phone number setup",
    PHONE_NUMBER_VERIFICATION: "the number verification",
    PERMISSIONS: "the permissions review",
  },
}

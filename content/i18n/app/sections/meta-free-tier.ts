// [Cupo gratis de Meta] (issue #171): la barra de la tarjeta de WhatsApp y el
// correo del 80 % y el 100 %. Todo el copy dice «Meta» a propósito: es el
// consumo que Meta factura directo al cliente, no la cuota del plan de
// Resender, y ninguna frase de acá puede leerse como un cobro nuestro.

export type MetaFreeTierDict = {
  title: string
  /** Al lado del título: el mes se corta en UTC, no en la zona de la WABA. */
  approx: string
  approxHint: string
  /** `{used}`, `{limit}` */
  freeUsed: string
  /** `{billed}` */
  billed: string
  /** `{limit}`: la línea bajo la barra cuando ya no queda cupo. */
  exhausted: string
  /** `{limit}` */
  nearHint: string
  explainer: string
  pricingLink: string
  unavailable: string
  email: {
    /** `{phone}` */
    subject80: string
    /** `{phone}` */
    subject100: string
    preheader80: string
    preheader100: string
    heading80: string
    heading100: string
    /** `{phone}`, `{used}`, `{limit}` */
    intro80: string
    /** `{phone}`, `{limit}` */
    intro100: string
    body80: string
    body100: string
    notResenderNote: string
    ctaLabel: string
    pricingLabel: string
    footerNote: string
  }
}

export const es: MetaFreeTierDict = {
  title: "Cupo gratis de Meta",
  approx: "aprox.",
  approxHint:
    "Contamos el mes en UTC. Meta lo corta en la zona horaria de tu WABA, así que puede haber unas horas de diferencia al cambiar de mes.",
  freeUsed: "{used} de {limit} mensajes gratis de Meta este mes",
  billed: "{billed} mensajes cobrados por Meta",
  exhausted: "Ya usaste los {limit} mensajes gratis de este mes.",
  nearHint:
    "Te queda poco cupo gratis. Pasando de {limit}, Meta cobra cada respuesta entregada.",
  explainer:
    "Meta te factura estos mensajes directo, a la tarjeta de tu WABA. No es la cuota de tu plan de Resender y no lo cobramos nosotros.",
  pricingLink: "Ver tarifas de Meta",
  unavailable: "No pudimos leer el consumo de Meta de este número.",
  email: {
    subject80: "{phone} ya usó el 80 % de sus mensajes gratis de Meta",
    subject100: "{phone} agotó sus mensajes gratis de Meta de este mes",
    preheader80:
      "Cuando pase de los gratis, Meta te va a cobrar cada respuesta entregada.",
    preheader100:
      "Desde ahora Meta te cobra cada respuesta entregada hasta que termine el mes.",
    heading80: "Te queda poco cupo gratis de Meta",
    heading100: "Se acabó el cupo gratis de Meta",
    intro80:
      "Tu número de WhatsApp {phone} lleva {used} de sus {limit} mensajes de servicio gratis de este mes.",
    intro100:
      "Tu número de WhatsApp {phone} ya usó sus {limit} mensajes de servicio gratis de este mes.",
    body80:
      "Pasando de ese cupo, Meta cobra cada respuesta entregada con la tarifa del país de quien la recibe. Revisa que tu WABA tenga un método de pago al día para que Meta no deje de entregar tus respuestas.",
    body100:
      "Desde ahora y hasta que termine el mes, Meta cobra cada respuesta entregada con la tarifa del país de quien la recibe. Revisa que tu WABA tenga un método de pago al día para que Meta no deje de entregar tus respuestas.",
    notResenderNote:
      "Este cobro es de Meta y te lo factura Meta, directo a tu WABA. No es la cuota de tu plan de Resender ni un cargo nuestro. Contamos el mes en UTC, así que el conteo es aproximado: la factura de Meta es la que vale.",
    ctaLabel: "Ver el consumo en Resender",
    pricingLabel: "Tarifas de WhatsApp en Meta",
    footerNote: "Resender · resender.dev",
  },
}

export const en: MetaFreeTierDict = {
  title: "Meta free tier",
  approx: "approx.",
  approxHint:
    "We count the month in UTC. Meta cuts it in your WABA's time zone, so it can be a few hours off around the turn of the month.",
  freeUsed: "{used} of {limit} free Meta messages this month",
  billed: "{billed} messages charged by Meta",
  exhausted: "You've used the {limit} free messages for this month.",
  nearHint:
    "You're running low on free messages. Past {limit}, Meta charges for every delivered reply.",
  explainer:
    "Meta bills these messages to you directly, on your WABA's card. This isn't your Resender plan quota and we don't charge it.",
  pricingLink: "See Meta's rates",
  unavailable: "We couldn't read this number's Meta usage.",
  email: {
    subject80: "{phone} has used 80% of its free Meta messages",
    subject100: "{phone} has used up its free Meta messages for this month",
    preheader80:
      "Once it goes past the free ones, Meta will charge you for every delivered reply.",
    preheader100:
      "From now on Meta charges you for every delivered reply until the month ends.",
    heading80: "You're running low on free Meta messages",
    heading100: "Your free Meta messages are used up",
    intro80:
      "Your WhatsApp number {phone} has used {used} of its {limit} free service messages this month.",
    intro100:
      "Your WhatsApp number {phone} has used all {limit} of its free service messages this month.",
    body80:
      "Past that allowance, Meta charges for every delivered reply at the rate of the recipient's country. Make sure your WABA has an up-to-date payment method so Meta keeps delivering your replies.",
    body100:
      "From now until the month ends, Meta charges for every delivered reply at the rate of the recipient's country. Make sure your WABA has an up-to-date payment method so Meta keeps delivering your replies.",
    notResenderNote:
      "This charge is Meta's and Meta bills it to you, directly on your WABA. It isn't your Resender plan quota or a charge from us. We count the month in UTC, so the count is approximate: Meta's invoice is what counts.",
    ctaLabel: "See usage in Resender",
    pricingLabel: "WhatsApp rates on Meta",
    footerNote: "Resender · resender.dev",
  },
}

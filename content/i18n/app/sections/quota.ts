export type QuotaDict = {
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

export const es: QuotaDict = {
  warningTitle: "Te estás acercando a tu límite.",
  warningBody:
    "Llevas {usage} de los {limit} mensajes de tu plan en este período.",
  restrictedTitle: "Cuenta restringida.",
  blockedPageLimit:
    "Tu plan permite {maxPages} conexiones y tienes {activePageCount}. Desconecta conexiones para volver a enviar.",
  blockedQuota:
    "Agotaste los {limit} mensajes de tu plan en este período. Sube de plan para volver a enviar.",
  blockedPlanUnavailable:
    "No pudimos resolver los límites de tu plan. No se arregla desde tu cuenta: lo revisamos nosotros.",
  blockedDefault:
    "Tu cuenta dejó de enviar mensajes. Revisa tu suscripción para reanudarla.",
  ctaManagePages: "Administrar páginas",
  ctaContact: "Escríbenos",
  ctaUpgrade: "Subir de plan",
}

export const en: QuotaDict = {
  warningTitle: "You're close to your limit.",
  warningBody:
    "You've used {usage} of the {limit} messages in your plan for this period.",
  restrictedTitle: "Account restricted.",
  blockedPageLimit:
    "Your plan allows {maxPages} connections and you have {activePageCount}. Disconnect connections to start sending again.",
  blockedQuota:
    "You've used up the {limit} messages in your plan for this period. Upgrade your plan to start sending again.",
  blockedPlanUnavailable:
    "We couldn't resolve your plan's limits. This isn't something you can fix from your account: we're looking into it.",
  blockedDefault:
    "Your account stopped sending messages. Check your subscription to resume it.",
  ctaManagePages: "Manage pages",
  ctaContact: "Contact us",
  ctaUpgrade: "Upgrade plan",
}

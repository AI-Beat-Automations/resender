export type ShellDict = {
  home: string
  navConnections: string
  navInbox: string
  /** Padre y cliente: el catálogo de plantillas de WhatsApp de sus números. */
  navTemplates: string
  /** Solo el padre: un cliente no ve la sección Logs. */
  navLogs: string
  /** Solo se dibuja para los planes que pueden invitar (Pro y Business). */
  navClients: string
  navSettings: string
  navDocs: string
  /** Primer nivel del breadcrumb del header de la consola. */
  breadcrumbConsole: string
  /** Pie del sidebar: abre el Discord de soporte en otra pestaña. */
  needHelp: string
  /** Pie del sidebar: lleva a Ajustes → Suscripción. Nunca en Business. */
  upgradePlan: string
  theme: string
  signOut: string
}

export const es: ShellDict = {
  home: "Resender.dev — inicio",
  navConnections: "Conexiones",
  navInbox: "Inbox",
  navTemplates: "Plantillas",
  navLogs: "Logs",
  navClients: "Clientes",
  navSettings: "Ajustes",
  navDocs: "Documentación",
  breadcrumbConsole: "Consola",
  needHelp: "¿Necesitas ayuda?",
  upgradePlan: "Mejora tu plan",
  theme: "tema",
  signOut: "Cerrar sesión",
}

export const en: ShellDict = {
  home: "Resender.dev — home",
  navConnections: "Connections",
  navInbox: "Inbox",
  navTemplates: "Templates",
  navLogs: "Logs",
  navClients: "Clients",
  navSettings: "Settings",
  navDocs: "Documentation",
  breadcrumbConsole: "Console",
  needHelp: "Need help?",
  upgradePlan: "Upgrade your plan",
  theme: "theme",
  signOut: "Sign out",
}

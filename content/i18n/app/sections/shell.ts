export type ShellDict = {
  home: string
  navConnections: string
  navInbox: string
  /** Solo el padre: un cliente no ve la sección Logs. */
  navLogs: string
  /** Solo se dibuja para los planes que pueden invitar (Pro y Business). */
  navClients: string
  navSettings: string
  navDocs: string
  /** Primer nivel del breadcrumb del header de la consola. */
  breadcrumbConsole: string
  theme: string
  signOut: string
}

export const es: ShellDict = {
  home: "Resender.dev — inicio",
  navConnections: "Conexiones",
  navInbox: "Inbox",
  navLogs: "Logs",
  navClients: "Clientes",
  navSettings: "Ajustes",
  navDocs: "Documentación",
  breadcrumbConsole: "Consola",
  theme: "tema",
  signOut: "Cerrar sesión",
}

export const en: ShellDict = {
  home: "Resender.dev — home",
  navConnections: "Connections",
  navInbox: "Inbox",
  navLogs: "Logs",
  navClients: "Clients",
  navSettings: "Settings",
  navDocs: "Documentation",
  breadcrumbConsole: "Console",
  theme: "theme",
  signOut: "Sign out",
}

export type ShellDict = {
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

export const es: ShellDict = {
  home: "Resender.dev — inicio",
  navConnections: "Conexiones",
  navInbox: "Inbox",
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
  navClients: "Clients",
  navSettings: "Settings",
  navDocs: "Documentation",
  breadcrumbConsole: "Console",
  theme: "theme",
  signOut: "Sign out",
}

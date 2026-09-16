// Qué destinos dibuja el sidebar del producto, decidido en el servidor y sin
// React: el layout resuelve el actor y el plan, y el sidebar solo pinta. Dos
// entradas condicionales (issue #154): «Clientes» solo existe para los planes
// que pueden invitar, y un cliente ve la consola reducida —Conexiones, Inbox y
// Ajustes— sin Clientes ni la documentación de la API, que no consume.

export type NavKey =
  "navConnections" | "navInbox" | "navClients" | "navSettings" | "navDocs"

export type NavItemSpec = {
  href: string
  /** Clave del bloque `shell` del diccionario, no el texto ya resuelto. */
  label: NavKey
  external?: boolean
}

export type NavVisibility = {
  /** Plan Pro o Business: puede crear e invitar clientes. */
  showClients: boolean
  /** El actor es un cliente (`clientAccountId` no nulo): consola reducida. */
  isClient: boolean
}

export function productNavItems(visibility: NavVisibility): NavItemSpec[] {
  if (visibility.isClient) {
    return [
      { href: "/connections", label: "navConnections" },
      { href: "/inbox", label: "navInbox" },
      { href: "/settings", label: "navSettings" },
    ]
  }

  return [
    { href: "/connections", label: "navConnections" },
    { href: "/inbox", label: "navInbox" },
    ...(visibility.showClients
      ? [{ href: "/clientes", label: "navClients" as const }]
      : []),
    { href: "/settings", label: "navSettings" },
    { href: "/docs", label: "navDocs", external: true },
  ]
}

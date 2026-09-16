// Qué destinos dibuja el sidebar del producto, decidido en el servidor y sin
// React: el layout resuelve el plan y el sidebar solo pinta. Es la primera
// entrada condicional (issue #154): «Clientes» solo existe para los planes que
// pueden invitar. Cuando llegue el actor del cliente (ticket 2), la reducción
// a Conexiones/Inbox/Ajustes se decide acá también.

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
}

export function productNavItems(visibility: NavVisibility): NavItemSpec[] {
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

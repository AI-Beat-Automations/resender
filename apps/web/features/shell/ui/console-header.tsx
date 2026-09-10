import Link from "next/link"
import { Fragment, type ReactNode } from "react"

import type { AppDict } from "@/content/i18n/app"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"

export type Crumb = { label: string; href?: string }

// Header de la consola (mock `1e`–`1g`): 52px, borde inferior sutil,
// breadcrumb a la izquierda y el hueco de acciones de la pantalla a la
// derecha. Lo rellena el slot paralelo `@header` del layout, así cada ruta
// decide su miga y sus botones en el servidor, sin portales ni flashes.
export function ConsoleHeader({
  crumbs,
  actions,
  t,
}: {
  /** Niveles después de «Consola». El último es la página actual. */
  crumbs: Crumb[]
  actions?: ReactNode
  t: AppDict
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between gap-4 border-b border-border-subtle px-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <span>{t.shell.breadcrumbConsole}</span>
          </BreadcrumbItem>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <Fragment key={`${crumb.label}-${index}`}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {last || !crumb.href ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}

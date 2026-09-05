"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { useAppDict } from "@/content/i18n/app/provider"
import type { AppDict } from "@/content/i18n/app"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"

import { HeaderActionsSlot } from "./header-actions"

// Header de la consola (ADR 0015): 52 px, breadcrumb «Consola › {pantalla}» a
// la izquierda y el hueco de acciones de la pantalla a la derecha. Es cliente
// por `usePathname()`: la etiqueta sale de la ruta, no de props de cada página.

type ShellDict = AppDict["shell"]
type Crumb = { label: keyof ShellDict; href?: string }

// Mapa ruta → migas, del más específico al más general. `/settings/*` cae en
// Ajustes porque sus pestañas viven en la URL como `?tab=`, no como segmentos.
const CRUMBS: Array<{ prefix: string; crumbs: Crumb[] }> = [
  {
    prefix: "/connections/select",
    crumbs: [
      { label: "navConnections", href: "/connections" },
      { label: "breadcrumbSelectPages" },
    ],
  },
  { prefix: "/connections", crumbs: [{ label: "navConnections" }] },
  { prefix: "/inbox", crumbs: [{ label: "navInbox" }] },
  { prefix: "/settings", crumbs: [{ label: "navSettings" }] },
]

function resolveCrumbs(pathname: string): Crumb[] {
  const match = CRUMBS.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
  return match?.crumbs ?? []
}

export function ConsoleHeader() {
  const pathname = usePathname()
  const t = useAppDict().shell
  const crumbs = resolveCrumbs(pathname)

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border-subtle bg-background px-6">
      <Breadcrumb>
        <BreadcrumbList className="text-sm">
          <BreadcrumbItem>
            {/* «Consola» es la raíz y no tiene ruta propia: lleva a Conexiones. */}
            <BreadcrumbLink asChild>
              <Link href="/connections">{t.breadcrumbConsole}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <React.Fragment key={crumb.label}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {last ? (
                    <BreadcrumbPage className="font-medium">
                      {t[crumb.label]}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href ?? "#"}>{t[crumb.label]}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <HeaderActionsSlot />
    </header>
  )
}

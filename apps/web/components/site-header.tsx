"use client"

import * as React from "react"
import Link from "next/link"
import { Menu } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet"

import { SiteLogo } from "@/components/site-logo"
import { ThemeToggle } from "@/components/theme-toggle"

const navLinks = [
  { href: "/pricing", label: "Precios" },
  { href: "/blog", label: "Blog" },
  { href: "/docs", label: "Docs" },
]

// Navbar público de marketing. Sticky, con logo, navegación, toggle de tema y
// CTAs a la app existente (Login / Get Started). El menú mobile usa Sheet.
export function SiteHeader() {
  const [open, setOpen] = React.useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
        <SiteLogo />

        {/* Navegación desktop */}
        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Button key={link.href} asChild variant="ghost" size="sm">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Iniciar sesión</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/register">Empezá gratis</Link>
          </Button>
        </div>

        {/* Menú mobile */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Abrir menú">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="sr-only">Menú</SheetTitle>
              <nav className="mt-8 flex flex-col gap-1 px-4">
                {navLinks.map((link) => (
                  <Button
                    key={link.href}
                    asChild
                    variant="ghost"
                    className="justify-start"
                    onClick={() => setOpen(false)}
                  >
                    <Link href={link.href}>{link.label}</Link>
                  </Button>
                ))}
                <div className="mt-4 flex flex-col gap-2">
                  <Button asChild variant="outline" onClick={() => setOpen(false)}>
                    <Link href="/login">Iniciar sesión</Link>
                  </Button>
                  <Button asChild onClick={() => setOpen(false)}>
                    <Link href="/register">Empezá gratis</Link>
                  </Button>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

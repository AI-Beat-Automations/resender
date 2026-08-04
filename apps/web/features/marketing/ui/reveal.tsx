"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

// Envuelve contenido para que aparezca (fade + slide-up) cuando entra al
// viewport al scrollear. La animación corre siempre: `prefers-reduced-motion`
// del sistema no la desactiva (decisión de producto, ver globals.css).
//
// El estado arranca en "static" a propósito: el HTML servido sale VISIBLE. Antes
// arrancaba oculto y ~40% del contenido único de la landing (pain points y pasos
// de "cómo funciona") se servía con `opacity-0`, a merced de que el renderer de
// Google disparara el IntersectionObserver — que no scrollea, así que lo de
// abajo del fold podía quedar invisible en su snapshot.
//
// Solo se pasa a "hidden" al montar, y únicamente si el bloque está debajo del
// fold: animar algo que ya se está viendo produciría un parpadeo.
type RevealState = "static" | "hidden" | "shown"

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [state, setState] = React.useState<RevealState>("static")

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.getBoundingClientRect().top < window.innerHeight) return

    setState("hidden")

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setState("shown")
          observer.disconnect()
        }
      },
      { threshold: 0.2 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        "transition-all duration-700 ease-out",
        state === "hidden"
          ? "translate-y-8 opacity-0"
          : "translate-y-0 opacity-100",
        className
      )}
    >
      {children}
    </div>
  )
}

"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

// Copiar al portapapeles: lo usan el `tenant_id` de Cuenta (solo icono, para
// pegarlo en un ticket de soporte) y el secreto de una API key recién creada,
// que no se vuelve a mostrar.
export function CopyButton({
  value,
  label,
  withText = false,
  variant = "ghost",
  size = "icon-sm",
}: {
  value: string
  label: string
  withText?: boolean
  variant?: "ghost" | "default" | "outline"
  size?: "icon-sm" | "sm" | "lg"
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      // Sin permiso de portapapeles no hay nada que reintentar; el valor
      // sigue visible y seleccionable a mano.
      console.error("clipboard copy failed", error)
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={copy}
      aria-label={withText ? undefined : label}
      title={withText ? undefined : label}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {withText ? (copied ? "Copiado" : "Copiar") : null}
    </Button>
  )
}

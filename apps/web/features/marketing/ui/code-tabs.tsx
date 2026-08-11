"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"

import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@workspace/ui/components/tabs"

// Tabs de lenguaje para el panel de código. Recibe el HTML ya resaltado por
// shiki (en el server) y lo inyecta. El client alterna el snippet visible; el
// ícono de portapapeles (arriba a la derecha del código) copia el tab activo.
export type Snippet = { id: string; label: string; html: string; code: string }

export function CodeTabs({
  snippets,
  copyLabel,
  copiedLabel,
}: {
  snippets: Snippet[]
  copyLabel: string
  copiedLabel: string
}) {
  const [active, setActive] = React.useState(snippets[0]?.id ?? "")
  const [copied, setCopied] = React.useState(false)

  const activeCode = snippets.find((s) => s.id === active)?.code ?? ""

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(activeCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard no disponible: no hacemos nada.
    }
  }

  return (
    <Tabs value={active} onValueChange={setActive} className="gap-0">
      <TabsList className="h-auto w-full justify-start rounded-none border-b border-border/70 bg-transparent p-0">
        {snippets.map((s) => (
          <TabsTrigger
            key={s.id}
            value={s.id}
            className="rounded-none border-0 border-b-2 border-transparent px-4 py-2.5 font-mono text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="relative">
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? copiedLabel : copyLabel}
          className="absolute top-2 right-2 z-10 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <Check className="size-4 text-primary" />
          ) : (
            <Copy className="size-4" />
          )}
        </button>
        {snippets.map((s) => (
          <TabsContent
            key={s.id}
            value={s.id}
            className="code-panel overflow-x-auto p-4 text-sm"
          >
            <div dangerouslySetInnerHTML={{ __html: s.html }} />
          </TabsContent>
        ))}
      </div>
    </Tabs>
  )
}

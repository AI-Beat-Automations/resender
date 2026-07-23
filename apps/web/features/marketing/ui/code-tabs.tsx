"use client"

import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@workspace/ui/components/tabs"

// Tabs de lenguaje para el panel de código. Recibe el HTML ya resaltado por
// shiki (en el server) y lo inyecta. El client solo alterna qué snippet se ve.
export type Snippet = { id: string; label: string; html: string }

export function CodeTabs({ snippets }: { snippets: Snippet[] }) {
  return (
    <Tabs defaultValue={snippets[0]?.id} className="gap-0">
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
      {snippets.map((s) => (
        <TabsContent
          key={s.id}
          value={s.id}
          className="code-panel overflow-x-auto p-4 text-sm"
        >
          <div dangerouslySetInnerHTML={{ __html: s.html }} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

import Link from "next/link"

import { Badge } from "@workspace/ui/components/badge"

// Filtro por página (spec C.1): el par seleccionado/no seleccionado son las
// variantes `default` / `outline` del Badge. Son enlaces, así que la pantalla
// sigue siendo server component.

export type MessagesFilterPage = {
  id: string
  name: string
}

export function MessagesPageFilter({
  pages,
  selectedPageId,
}: {
  pages: MessagesFilterPage[]
  selectedPageId: string | null
}) {
  return (
    <div className="mt-3.5 flex flex-wrap gap-2">
      <FilterPill
        href="/messages"
        label="Todas las páginas"
        active={!selectedPageId}
      />
      {pages.map((page) => (
        <FilterPill
          key={page.id}
          href={`/messages?page=${encodeURIComponent(page.id)}`}
          label={page.name}
          active={selectedPageId === page.id}
        />
      ))}
    </div>
  )
}

function FilterPill({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  return (
    <Badge
      asChild
      variant={active ? "default" : "outline"}
      className="h-6 px-3"
    >
      <Link href={href} aria-current={active ? "page" : undefined}>
        {label}
      </Link>
    </Badge>
  )
}

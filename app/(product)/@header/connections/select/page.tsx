import { ConsoleHeader } from "@/features/shell/ui/console-header"
import { getAppDict } from "@/lib/i18n/app-dict"

// Tres niveles (mock `1g`): el intermedio vuelve a Conexiones.
export default async function SelectPagesHeader() {
  const t = await getAppDict()
  return (
    <ConsoleHeader
      crumbs={[
        { label: t.connections.title, href: "/connections" },
        { label: t.select.title },
      ]}
      t={t}
    />
  )
}

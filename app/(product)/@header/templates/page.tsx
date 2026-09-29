import { ConsoleHeader } from "@/features/shell/ui/console-header"
import { getAppDict } from "@/lib/i18n/app-dict"

// Miga de `/templates`. Sin acciones: la pantalla es de solo lectura.
export default async function TemplatesHeader() {
  const t = await getAppDict()
  return <ConsoleHeader crumbs={[{ label: t.templates.title }]} t={t} />
}

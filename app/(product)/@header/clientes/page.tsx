import { ConsoleHeader } from "@/features/shell/ui/console-header"
import { getAppDict } from "@/lib/i18n/app-dict"

// Miga de `/clientes`. Sin acciones: el alta vive en la página, como pide el
// formulario de tres campos.
export default async function ClientsHeader() {
  const t = await getAppDict()
  return <ConsoleHeader crumbs={[{ label: t.clients.title }]} t={t} />
}

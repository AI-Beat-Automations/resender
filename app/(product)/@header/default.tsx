import { ConsoleHeader } from "@/features/shell/ui/console-header"
import { getAppDict } from "@/lib/i18n/app-dict"

// Rutas sin miga propia: solo «Consola».
export default async function DefaultHeader() {
  const t = await getAppDict()
  return <ConsoleHeader crumbs={[]} t={t} />
}

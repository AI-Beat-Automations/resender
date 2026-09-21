import { ConsoleHeader } from "@/features/shell/ui/console-header"
import { getAppDict } from "@/lib/i18n/app-dict"

export default async function LogsHeader() {
  const t = await getAppDict()
  return <ConsoleHeader crumbs={[{ label: t.requestLogs.title }]} t={t} />
}

import { ConsoleHeader } from "@/features/shell/ui/console-header"
import { getAppDict } from "@/lib/i18n/app-dict"

export default async function InboxHeader() {
  const t = await getAppDict()
  return <ConsoleHeader crumbs={[{ label: t.inbox.title }]} t={t} />
}

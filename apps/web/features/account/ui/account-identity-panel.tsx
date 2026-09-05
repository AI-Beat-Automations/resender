import type { Locale } from "@/content/i18n"
import type { AppDict } from "@/content/i18n/app"
import { CopyButton } from "@/features/settings/ui/copy-button"
import { LanguagePanel } from "@/features/settings/ui/language-panel"
import {
  SettingsCardHeader,
  SettingsDataRow,
} from "@/features/settings/ui/settings-card"
import { Card, CardContent } from "@workspace/ui/components/card"

// Identidad de la cuenta (B6, mock 1j): email, `tenant_id` en mono con botón
// de copiar —su único uso es pegarlo en un ticket de soporte— e idioma. El
// idioma va acá y no en una tarjeta propia: es una preferencia de lectura de
// quien entra, como el email con el que entra.
export function AccountIdentityPanel({
  email,
  tenantId,
  lang,
  t,
}: {
  email: string
  tenantId: string
  lang: Locale
  t: AppDict
}) {
  return (
    <Card>
      <SettingsCardHeader title={t.account.title} />
      <CardContent className="flex flex-col gap-3">
        <SettingsDataRow label={t.account.emailLabel}>
          <span className="min-w-0 truncate">{email}</span>
        </SettingsDataRow>
        <SettingsDataRow label={t.account.tenantIdLabel}>
          <code className="min-w-0 truncate rounded-md bg-muted px-2 py-0.5 font-mono text-[12px]">
            {tenantId}
          </code>
          <CopyButton value={tenantId} label={t.account.copyTenantId} />
        </SettingsDataRow>
        <SettingsDataRow label={t.settings.language.title}>
          <LanguagePanel lang={lang} t={t} />
        </SettingsDataRow>
      </CardContent>
    </Card>
  )
}

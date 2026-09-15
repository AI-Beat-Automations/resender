import type { AppDict } from "@/content/i18n/app"
import { CopyButton } from "@/features/settings/ui/copy-button"
import {
  SettingsCard,
  SettingsCardTitle,
  SettingsDataRow,
} from "@/features/settings/ui/settings-card"

// Identidad de la cuenta (B6). El `tenant_id` va en mono y con botón de copiar
// porque su único uso es pegarlo en un ticket de soporte.
export function AccountIdentityPanel({
  email,
  tenantId,
  t,
}: {
  email: string
  tenantId: string
  t: AppDict
}) {
  return (
    <SettingsCard>
      <SettingsCardTitle>{t.account.title}</SettingsCardTitle>
      <div className="mt-4 flex flex-col gap-2.5">
        <SettingsDataRow label={t.account.emailLabel}>
          <span className="min-w-0 truncate text-[13.5px]">{email}</span>
        </SettingsDataRow>
        <SettingsDataRow label={t.account.tenantIdLabel}>
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
            {tenantId}
          </span>
          <CopyButton value={tenantId} label={t.account.copyTenantId} />
        </SettingsDataRow>
      </div>
    </SettingsCard>
  )
}

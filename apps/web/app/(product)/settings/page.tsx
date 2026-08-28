import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { AccountIdentityPanel } from "@/features/account/ui/account-identity-panel"
import { ChangePasswordPanel } from "@/features/account/ui/change-password-panel"
import { DeleteAccountPanel } from "@/features/account/ui/delete-account-panel"
import {
  ApiKeysPanel,
  type ApiKeyView,
} from "@/features/api-keys/ui/api-keys-panel"
import {
  SubscriptionPanel,
  type SubscriptionView,
} from "@/features/billing/ui/subscription-panel"
import { LanguagePanel } from "@/features/settings/ui/language-panel"
import { SettingsTabsNav } from "@/features/settings/ui/settings-tabs-nav"
import { listApiKeys } from "@/lib/api-keys/api-keys"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import type { TenantEntitlement } from "@/lib/billing/entitlements"
import { getPlanByLookupKey } from "@/lib/billing/plans"
import { getSubscriptionByTenantId } from "@/lib/billing/subscription"
import { resolveSettingsTab } from "@/lib/settings/settings-tabs"
import type { Locale } from "@/content/i18n"
import type { AppDict } from "@/content/i18n/app"
import { getAppI18n } from "@/lib/i18n/app-dict"
import { Separator } from "@workspace/ui/components/separator"

type SettingsPageProps = {
  searchParams: Promise<{ tab?: string | string[] }>
}

// Ajustes en tres pestañas con el estado en la URL (ADR 0005). Cada pestaña
// consulta solo lo suyo: entrar a Cuenta no lee las API keys ni Stripe.
export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const [session, params, { lang, t }] = await Promise.all([
    auth(),
    searchParams,
    getAppI18n(),
  ])
  if (!session?.user?.id) redirect("/login")

  const tab = resolveSettingsTab(params.tab)

  return (
    <div className="flex flex-col">
      <header>
        <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-subtle)]">
          {`// ${t.settings.eyebrow}`}
        </p>
        <h1 className="mt-1.5 font-heading text-[26px] font-bold tracking-[-0.02em]">
          {t.settings.title}
        </h1>
        {tab === "cuenta" ? (
          <p className="mt-2 max-w-155 text-[14.5px]/[1.6] text-muted-foreground">
            {t.settings.subtitle}
          </p>
        ) : null}
        <SettingsTabsNav active={tab} t={t} />
      </header>

      <div className="mt-6">
        {tab === "cuenta" ? (
          <AccountTab
            email={session.user.email ?? ""}
            tenantId={session.user.id}
            lang={lang}
            t={t}
          />
        ) : null}
        {tab === "api-keys" ? (
          <ApiKeysTab tenantId={session.user.id} t={t} />
        ) : null}
        {tab === "suscripcion" ? (
          <SubscriptionTab tenantId={session.user.id} t={t} />
        ) : null}
      </div>
    </div>
  )
}

function AccountTab({
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
    <div className="flex max-w-205 flex-col gap-4">
      <AccountIdentityPanel email={email} tenantId={tenantId} t={t} />
      {/* El idioma va en Cuenta y no en una pestaña propia: es una preferencia
          de lectura de quien entra, como el email con el que entra. */}
      <LanguagePanel lang={lang} t={t} />
      <ChangePasswordPanel />
      {/* La zona de peligro va separada del resto: borrar la cuenta no puede
          leerse a la misma altura que cambiar la contraseña. */}
      {email ? (
        <>
          <Separator className="my-2" />
          <DeleteAccountPanel email={email} />
        </>
      ) : null}
    </div>
  )
}

async function ApiKeysTab({ tenantId, t }: { tenantId: string; t: AppDict }) {
  const apiKeys = await listApiKeys(tenantId)

  return (
    <div className="max-w-225">
      <ApiKeysPanel apiKeys={apiKeys.map(toApiKeyView)} t={t} />
    </div>
  )
}

async function SubscriptionTab({
  tenantId,
  t,
}: {
  tenantId: string
  t: AppDict
}) {
  const subscription = await getSubscriptionByTenantId(tenantId)

  // El entitlement solo alimenta el consumo: si no se puede resolver, la
  // pestaña muestra el bloqueo con soporte en vez de tirar la pantalla.
  let entitlement: TenantEntitlement | null = null
  try {
    entitlement = await getTenantEntitlement(tenantId)
  } catch (error) {
    console.error("tenant entitlement unavailable", error)
  }

  return (
    <div className="max-w-160">
      <SubscriptionPanel
        subscription={
          subscription ? toSubscriptionView(subscription, entitlement) : null
        }
        t={t}
      />
    </div>
  )
}

function toSubscriptionView(
  subscription: NonNullable<
    Awaited<ReturnType<typeof getSubscriptionByTenantId>>
  >,
  entitlement: TenantEntitlement | null
): SubscriptionView {
  const plan = getPlanByLookupKey(subscription.priceLookupKey)

  return {
    planName: plan?.name ?? subscription.priceLookupKey,
    planPriceMonthlyUsd: plan?.priceMonthlyUsd ?? null,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    usage: entitlement?.usage ?? 0,
    messageLimit: entitlement?.limits?.messagesPerPeriod ?? null,
    pagesInUse: entitlement?.activePageCount ?? 0,
    pageLimit: entitlement?.limits?.maxPages ?? null,
  }
}

function toApiKeyView(
  apiKey: Awaited<ReturnType<typeof listApiKeys>>[number]
): ApiKeyView {
  return {
    id: apiKey.id,
    label: apiKey.label,
    visiblePrefix: apiKey.visiblePrefix,
    status: apiKey.status,
    createdAt: apiKey.createdAt.toISOString(),
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    revokedAt: apiKey.revokedAt?.toISOString() ?? null,
  }
}

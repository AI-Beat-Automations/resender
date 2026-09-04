import { redirect } from "next/navigation"

import { listApiKeys } from "@/lib/auth/api-keys"
import { isEmailVerified } from "@/lib/auth/email-verified"
import { isGoogleEnabled } from "@/lib/auth/google"
import { getSession } from "@/lib/auth/session"
import { listSignInMethods } from "@/lib/auth/sign-in-methods"
import { AccountIdentityPanel } from "@/features/account/ui/account-identity-panel"
import { ChangePasswordPanel } from "@/features/account/ui/change-password-panel"
import { DeleteAccountPanel } from "@/features/account/ui/delete-account-panel"
import { SignInMethodsPanel } from "@/features/account/ui/sign-in-methods-panel"
import { resendVerificationEmailAction } from "@/features/auth/actions"
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
  // `error` es el rebote del flujo de Google lanzado desde «Vincular»
  // (`errorCallbackURL: /settings?tab=cuenta`), crudo: lo clasifica el panel.
  searchParams: Promise<{ tab?: string | string[]; error?: string }>
}

// Ajustes en tres pestañas con el estado en la URL (ADR 0005). Cada pestaña
// consulta solo lo suyo: entrar a Cuenta no lee las API keys ni Stripe.
export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const [session, params, { lang, t }] = await Promise.all([
    getSession(),
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
            oauthError={params.error}
          />
        ) : null}
        {tab === "api-keys" ? <ApiKeysTab t={t} /> : null}
        {tab === "suscripcion" ? (
          <SubscriptionTab tenantId={session.user.id} t={t} />
        ) : null}
      </div>
    </div>
  )
}

// Async por el panel de credenciales: `email_verified` se lee **vivo** (nunca
// de la sesión, que lo cachea cinco minutos) y las credenciales salen de
// `listUserAccounts`. Las dos consultas son el costo aceptado en el issue #98.
async function AccountTab({
  email,
  tenantId,
  lang,
  t,
  oauthError,
}: {
  email: string
  tenantId: string
  lang: Locale
  t: AppDict
  oauthError?: string
}) {
  const [verified, methods] = await Promise.all([
    isEmailVerified(tenantId),
    listSignInMethods(),
  ])

  return (
    <div className="flex max-w-205 flex-col gap-4">
      <AccountIdentityPanel email={email} tenantId={tenantId} t={t} />
      {/* El idioma va en Cuenta y no en una pestaña propia: es una preferencia
          de lectura de quien entra, como el email con el que entra. */}
      <LanguagePanel lang={lang} t={t} />
      <ChangePasswordPanel />
      {/* `resendVerificationEmailAction` es de `features/auth`: la página la
          pasa por prop porque `features/account` no importa a su hermana. Una
          sola acción para `/login`, `/pending` y acá. */}
      <SignInMethodsPanel
        email={email}
        verified={verified}
        methods={methods}
        googleEnabled={isGoogleEnabled()}
        lang={lang}
        t={t}
        resendAction={resendVerificationEmailAction}
        oauthError={oauthError}
      />
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

// Sin `tenantId`: el plugin `apiKey` resuelve el dueño desde la cookie de
// sesion, asi que la pantalla no puede pedir las keys de otro tenant ni por
// error de tipeo. Ver `lib/auth/api-keys.ts`.
async function ApiKeysTab({ t }: { t: AppDict }) {
  const apiKeys = await listApiKeys()

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
  }
}

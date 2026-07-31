import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { AccountIdentityPanel } from "@/features/account/ui/account-identity-panel"
import { ChangePasswordPanel } from "@/features/account/ui/change-password-panel"
import { DeleteAccountPanel } from "@/features/account/ui/delete-account-panel"
import { ApiKeysPanel } from "@/features/api-keys/ui/api-keys-panel"
import {
  SubscriptionPanel,
  type SubscriptionView,
} from "@/features/billing/ui/subscription-panel"
import { SettingsTabsNav } from "@/features/settings/ui/settings-tabs-nav"
import { getPlanByLookupKey } from "@/lib/billing/plans"
import {
  loadSettingsAccount,
  loadSettingsApiKeys,
  loadSettingsBilling,
} from "@/lib/settings/page-data"
import { resolveSettingsTab } from "@/lib/settings/settings-tabs"
import type { BillingStateDto } from "@workspace/contracts"
import { Separator } from "@workspace/ui/components/separator"

type SettingsPageProps = {
  searchParams: Promise<{ tab?: string | string[] }>
}

// Ajustes en tres pestañas con el estado en la URL (ADR 0005). Cada pestaña
// consulta solo lo suyo: entrar a Cuenta no lee las API keys ni Stripe.
export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const [session, params] = await Promise.all([auth(), searchParams])
  if (!session?.user?.id) redirect("/login")

  const tab = resolveSettingsTab(params.tab)

  return (
    <div className="flex flex-col">
      <header>
        <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-subtle)]">
          {"// ajustes"}
        </p>
        <h1 className="mt-1.5 font-heading text-[26px] font-bold tracking-[-0.02em]">
          Ajustes
        </h1>
        {tab === "cuenta" ? (
          <p className="mt-2 max-w-155 text-[14.5px]/[1.6] text-muted-foreground">
            Administra tu cuenta y las API keys de integración externa.
          </p>
        ) : null}
        <SettingsTabsNav active={tab} />
      </header>

      <div className="mt-6">
        {tab === "cuenta" ? (
          <AccountTab actor={{ userId: session.user.id }} />
        ) : null}
        {tab === "api-keys" ? (
          <ApiKeysTab actor={{ userId: session.user.id }} />
        ) : null}
        {tab === "suscripcion" ? (
          <SubscriptionTab actor={{ userId: session.user.id }} />
        ) : null}
      </div>
    </div>
  )
}

async function AccountTab({ actor }: { actor: { userId: string } }) {
  const result = await loadSettingsAccount(actor)
  if (result.kind === "redirect") redirect(result.destination)
  const { email, tenantId } = result.data

  return (
    <div className="flex max-w-205 flex-col gap-4">
      <AccountIdentityPanel email={email} tenantId={tenantId} />
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

async function ApiKeysTab({ actor }: { actor: { userId: string } }) {
  const result = await loadSettingsApiKeys(actor)
  if (result.kind === "redirect") redirect(result.destination)

  return (
    <div className="max-w-225">
      <ApiKeysPanel apiKeys={result.data} />
    </div>
  )
}

async function SubscriptionTab({ actor }: { actor: { userId: string } }) {
  const result = await loadSettingsBilling(actor)
  if (result.kind === "redirect") redirect(result.destination)
  const { subscription, entitlement } = result.data

  return (
    <div className="max-w-160">
      <SubscriptionPanel
        subscription={
          subscription ? toSubscriptionView(subscription, entitlement) : null
        }
      />
    </div>
  )
}

function toSubscriptionView(
  subscription: NonNullable<BillingStateDto["subscription"]>,
  entitlement: BillingStateDto["entitlement"]
): SubscriptionView {
  const plan = getPlanByLookupKey(subscription.priceLookupKey)

  return {
    planName: plan?.name ?? subscription.priceLookupKey,
    planPriceMonthlyUsd: plan?.priceMonthlyUsd ?? null,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    usage: entitlement.usage,
    messageLimit: entitlement.messageLimit,
    pagesInUse: entitlement.activePageCount,
    pageLimit: entitlement.pageLimit,
  }
}

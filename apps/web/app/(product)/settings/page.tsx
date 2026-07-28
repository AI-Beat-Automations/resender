import { auth } from "@/auth"
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
import { listApiKeys } from "@/lib/api-keys/api-keys"
import { getTenantEntitlement } from "@/lib/billing/entitlement-status"
import type { TenantEntitlement } from "@/lib/billing/entitlements"
import { getPlanByLookupKey } from "@/lib/billing/plans"
import { getSubscriptionByTenantId } from "@/lib/billing/subscription"

export default function SettingsPage() {
  return <SettingsContent />
}

async function SettingsContent() {
  const session = await auth()
  const apiKeys = session?.user?.id ? await listApiKeys(session.user.id) : []
  const subscription = session?.user?.id
    ? await getSubscriptionByTenantId(session.user.id)
    : null
  const entitlement = session?.user?.id
    ? await getTenantEntitlement(session.user.id)
    : null

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Manage your account and external integration API keys.
        </p>
      </div>
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-medium">Account</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tenant ID: {session?.user?.id}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Email: {session?.user?.email}
        </p>
      </section>
      <SubscriptionPanel
        subscription={
          subscription ? toSubscriptionView(subscription, entitlement) : null
        }
      />
      <ChangePasswordPanel />
      <ApiKeysPanel apiKeys={apiKeys.map(toApiKeyView)} />
      {session?.user?.email && (
        <DeleteAccountPanel email={session.user.email} />
      )}
    </div>
  )
}

function toSubscriptionView(
  subscription: NonNullable<
    Awaited<ReturnType<typeof getSubscriptionByTenantId>>
  >,
  entitlement: TenantEntitlement | null
): SubscriptionView {
  return {
    planName:
      getPlanByLookupKey(subscription.priceLookupKey)?.name ??
      subscription.priceLookupKey,
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

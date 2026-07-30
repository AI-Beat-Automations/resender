import "server-only"

import type {
  ProductShellDto,
  RpcActor,
  RpcPageDto,
} from "@workspace/contracts"

import {
  BackendProtocolError,
  BackendRpcError,
  BackendUnavailableError,
  getProductShell,
  listPages,
} from "@/lib/backend/backend"

import type { ConnectedPageView, PageQuotaView } from "./view-model"

type ConnectionsPageDependencies = {
  listPages(actor: RpcActor): Promise<RpcPageDto[]>
  getProductShell(actor: RpcActor): Promise<ProductShellDto>
}

const DEFAULT_DEPENDENCIES: ConnectionsPageDependencies = {
  listPages,
  getProductShell,
}

export type ConnectionsPageData = {
  pages: ConnectedPageView[]
  quota: PageQuotaView
}

export type ConnectionsPageLoadResult =
  | { kind: "ready"; data: ConnectionsPageData }
  | { kind: "redirect"; destination: "/waitlist" | "/billing" }

const dateTimeFormat = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export async function loadConnectionsPageData(
  actor: RpcActor,
  dependencies: ConnectionsPageDependencies = DEFAULT_DEPENDENCIES
): Promise<ConnectionsPageLoadResult> {
  let rpcPages: RpcPageDto[]
  try {
    rpcPages = await dependencies.listPages(actor)
  } catch (error) {
    const destination = accessRaceDestination(error)
    if (destination) return { kind: "redirect", destination }
    throw error
  }

  const pages = rpcPages
    .map(toConnectedPageView)
    .sort((left, right) => cardRank(left) - cardRank(right))

  try {
    const shell = await dependencies.getProductShell(actor)
    const quota = shell.entitlement.pageLimit
      ? {
          activePageCount: shell.entitlement.activePageCount,
          maxPages: shell.entitlement.pageLimit,
        }
      : null
    return { kind: "ready", data: { pages, quota } }
  } catch (error) {
    const destination = accessRaceDestination(error)
    if (destination) return { kind: "redirect", destination }
    if (error instanceof BackendProtocolError) throw error
    if (isRecoverableQuotaFailure(error)) {
      reportUnavailableQuota(error)
      return { kind: "ready", data: { pages, quota: null } }
    }
    throw error
  }
}

export function toConnectedPageView(page: RpcPageDto): ConnectedPageView {
  return {
    id: page.id,
    metaPageId: page.providerPageId,
    name: page.name,
    status: page.status,
    tokenStatus: page.tokenStatus,
    tokenErrorLabel:
      page.tokenStatus === "invalid"
        ? "Meta rechazó la credencial de esta página."
        : null,
    webhookUrl: page.webhook.url,
    webhookSigningEnabled: page.webhook.signingEnabled,
    connectedAt: page.connectedAt,
    connectedAtLabel: formatContractDate(page.connectedAt),
    tokenErrorAt: page.tokenErrorAt,
    tokenErrorAtLabel: page.tokenErrorAt
      ? formatContractDate(page.tokenErrorAt)
      : null,
    disconnectedAt: page.disconnectedAt,
    disconnectedAtLabel: page.disconnectedAt
      ? formatContractDate(page.disconnectedAt)
      : null,
  }
}

function cardRank(page: ConnectedPageView) {
  if (page.status !== "active") return 2
  return page.tokenStatus === "invalid" ? 1 : 0
}

function formatContractDate(value: string) {
  return dateTimeFormat.format(new Date(value))
}

function accessRaceDestination(
  error: unknown
): "/waitlist" | "/billing" | null {
  if (!(error instanceof BackendRpcError)) return null
  if (
    error.classification.code === "account_waitlisted" ||
    error.classification.code === "not_found"
  ) {
    return "/waitlist"
  }
  if (error.classification.code === "subscription_required") return "/billing"
  return null
}

function isRecoverableQuotaFailure(
  error: unknown
): error is BackendUnavailableError | BackendRpcError {
  return (
    error instanceof BackendUnavailableError ||
    (error instanceof BackendRpcError &&
      ["internal", "transient", "provider"].includes(error.classification.kind))
  )
}

function reportUnavailableQuota(
  error: BackendUnavailableError | BackendRpcError
) {
  const metadata =
    error instanceof BackendRpcError
      ? {
          kind: error.classification.kind,
          code: error.classification.code,
          status: error.classification.status,
          retryable: error.classification.retryable,
        }
      : { kind: "unavailable" as const }
  console.warn("Connections quota unavailable.", metadata)
}

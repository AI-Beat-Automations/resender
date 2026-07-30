import "server-only"

import type {
  ApiKeyDto,
  BillingStateDto,
  ProductShellDto,
  RpcActor,
} from "@workspace/contracts"

import {
  BackendRpcError,
  getBillingState,
  getProductShell,
  listApiKeys,
} from "@/lib/backend/backend"

import type { ApiKeyView, SettingsAccountView } from "./view-model"

export type SettingsLoadResult<T> =
  | { kind: "ready"; data: T }
  | { kind: "redirect"; destination: "/waitlist" | "/billing" }

type SettingsPageDependencies = {
  getProductShell(actor: RpcActor): Promise<ProductShellDto>
  listApiKeys(actor: RpcActor): Promise<ApiKeyDto[]>
  getBillingState(actor: RpcActor): Promise<BillingStateDto>
}

const DEFAULT_DEPENDENCIES: SettingsPageDependencies = {
  getProductShell,
  listApiKeys,
  getBillingState,
}

export async function loadSettingsAccount(
  actor: RpcActor,
  dependencies: SettingsPageDependencies = DEFAULT_DEPENDENCIES
): Promise<SettingsLoadResult<SettingsAccountView>> {
  try {
    const shell = await dependencies.getProductShell(actor)
    return {
      kind: "ready",
      data: { email: shell.email, tenantId: shell.tenantId },
    }
  } catch (error) {
    const destination = settingsAccessDestination(error)
    if (destination) return { kind: "redirect", destination }
    throw error
  }
}

export async function loadSettingsApiKeys(
  actor: RpcActor,
  dependencies: SettingsPageDependencies = DEFAULT_DEPENDENCIES
): Promise<SettingsLoadResult<ApiKeyView[]>> {
  try {
    const apiKeys = await dependencies.listApiKeys(actor)
    return { kind: "ready", data: apiKeys }
  } catch (error) {
    const destination = settingsAccessDestination(error)
    if (destination) return { kind: "redirect", destination }
    throw error
  }
}

export async function loadSettingsBilling(
  actor: RpcActor,
  dependencies: SettingsPageDependencies = DEFAULT_DEPENDENCIES
): Promise<SettingsLoadResult<BillingStateDto>> {
  try {
    const state = await dependencies.getBillingState(actor)
    if (state.subscription?.status !== "active") {
      return { kind: "redirect", destination: "/billing" }
    }
    return { kind: "ready", data: state }
  } catch (error) {
    const destination = settingsAccessDestination(error)
    if (destination) return { kind: "redirect", destination }
    throw error
  }
}

function settingsAccessDestination(
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

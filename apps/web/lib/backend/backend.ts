import "server-only"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import {
  BackendHealthSchema,
  type BackendHealthDto,
  type WebAppApiContract,
} from "@workspace/contracts"

import {
  classifyRpcError,
  type RpcErrorClassification,
} from "./rpc-error"

const UNAVAILABLE_MESSAGE = "Backend service is unavailable."
const REQUEST_FAILED_MESSAGE = "Backend request failed."
const INVALID_RESPONSE_MESSAGE = "Backend response is invalid."

export class BackendUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_MESSAGE)
    this.name = "BackendUnavailableError"
  }
}

export class BackendRpcError extends Error {
  readonly classification: RpcErrorClassification

  constructor(classification: RpcErrorClassification) {
    super(REQUEST_FAILED_MESSAGE)
    this.name = "BackendRpcError"
    this.classification = classification
  }
}

export class BackendProtocolError extends Error {
  constructor() {
    super(INVALID_RESPONSE_MESSAGE)
    this.name = "BackendProtocolError"
  }
}

export async function getBackend(): Promise<WebAppApiContract> {
  let context: Awaited<ReturnType<typeof getCloudflareContext>>
  try {
    context = await getCloudflareContext({ async: true })
  } catch {
    throw new BackendUnavailableError()
  }

  const binding: CloudflareEnv["BACKEND"] | undefined = context.env.BACKEND
  if (!binding) throw new BackendUnavailableError()
  const backend: WebAppApiContract = binding
  return backend
}

export async function smokeBackend(): Promise<BackendHealthDto> {
  const backend = await getBackend()

  let response: BackendHealthDto
  try {
    response = await backend.health()
  } catch (error) {
    throw new BackendRpcError(classifyRpcError(error))
  }

  const parsed = BackendHealthSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  return parsed.data
}

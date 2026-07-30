import "server-only"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import {
  BackendHealthSchema,
  ConversationListSchema,
  ConversationThreadSchema,
  ProductAccessSchema,
  ProductShellSchema,
  RpcPageListSchema,
  type BackendHealthDto,
  type ConversationListDto,
  type ConversationListInput,
  type ConversationThreadDto,
  type ConversationThreadRpcInput,
  type ProductAccessDto,
  type ProductShellDto,
  type RpcActor,
  type RpcPageDto,
  type WebAppApiContract,
} from "@workspace/contracts"

import { classifyRpcError, type RpcErrorClassification } from "./rpc-error"

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
  const response = await invokeBackend((backend) => backend.health())
  const parsed = BackendHealthSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  return parsed.data
}

export async function getProductAccess(
  actor: RpcActor
): Promise<ProductAccessDto> {
  const response = await invokeBackend((backend) =>
    backend.getProductAccess(actor)
  )
  const parsed = ProductAccessSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  return parsed.data
}

export async function getProductShell(
  actor: RpcActor
): Promise<ProductShellDto> {
  const response = await invokeBackend((backend) =>
    backend.getProductShell(actor)
  )
  const parsed = ProductShellSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  if (parsed.data.tenantId !== actor.userId) {
    throw new BackendProtocolError()
  }
  return parsed.data
}

export async function listConversations(
  actor: RpcActor,
  input: ConversationListInput
): Promise<ConversationListDto> {
  const response = await invokeBackend((backend) =>
    backend.listConversations(actor, input)
  )
  const parsed = ConversationListSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  if (
    input.pageId &&
    parsed.data.data.some(
      (conversation) => conversation.page.id !== input.pageId
    )
  ) {
    throw new BackendProtocolError()
  }
  return parsed.data
}

export async function getConversationThread(
  actor: RpcActor,
  input: ConversationThreadRpcInput
): Promise<ConversationThreadDto> {
  const response = await invokeBackend((backend) =>
    backend.getConversationThread(actor, input)
  )
  const parsed = ConversationThreadSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()

  const { conversation, messages } = parsed.data
  if (
    conversation.id !== input.conversationId ||
    messages.some(
      (message) =>
        message.conversationId !== input.conversationId ||
        message.pageId !== conversation.page.id ||
        message.contactId !== conversation.contact.id
    )
  ) {
    throw new BackendProtocolError()
  }
  return parsed.data
}

export async function listPages(actor: RpcActor): Promise<RpcPageDto[]> {
  const response = await invokeBackend((backend) => backend.listPages(actor))
  const parsed = RpcPageListSchema.safeParse(response)
  if (!parsed.success) throw new BackendProtocolError()
  return parsed.data
}

async function invokeBackend<T>(
  operation: (backend: WebAppApiContract) => Promise<T>
): Promise<T> {
  const backend = await getBackend()
  try {
    return await operation(backend)
  } catch (error) {
    throw new BackendRpcError(classifyRpcError(error))
  }
}

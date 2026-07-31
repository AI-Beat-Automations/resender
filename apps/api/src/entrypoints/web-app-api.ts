import { WorkerEntrypoint } from "cloudflare:workers"
import type {
  BackendHealthDto,
  ConnectMetaPagesInput,
  ConversationListInput,
  ConversationThreadRpcInput,
  RpcActor,
  WebAppApiContract,
} from "@workspace/contracts"
import {
  ApiKeyCreateRpcInputSchema,
  ApiKeyRevokeRpcInputSchema,
  AuthenticateCredentialsRpcInputSchema,
  BillingPortalSessionRpcInputSchema,
  ChangePasswordRpcInputSchema,
  CheckoutSessionRpcInputSchema,
  CheckoutVerificationRpcInputSchema,
  ConnectMetaPagesRpcInputSchema,
  ContractError,
  ConversationListQuerySchema,
  ConversationThreadRpcInputSchema,
  DeleteAccountRpcInputSchema,
  MetaAuthorizationRpcInputSchema,
  PageIdRpcInputSchema,
  PageWebhookUpdateRpcInputSchema,
  RegisterUserRpcInputSchema,
  RpcActorSchema,
} from "@workspace/contracts"
import type { ZodType } from "zod"

import { ApiService } from "../application/service"
import { API_MAX_LIMIT } from "../config"
import { apiRouter } from "../http/router"
import { handleLegacySend, LEGACY_SEND_PATH } from "../http/legacy-send"
import { log } from "../observability/logger"

export class WebAppApi
  extends WorkerEntrypoint<Env>
  implements WebAppApiContract
{
  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    const allowedMethods = privateHttpMethods(pathname)

    if (!allowedMethods) {
      return new Response("not found", { status: 404 })
    }

    if (!allowedMethods.some((method) => method === request.method)) {
      return new Response("method not allowed", {
        status: 405,
        headers: { Allow: allowedMethods.join(", ") },
      })
    }

    if (pathname === LEGACY_SEND_PATH) {
      return handleLegacySend(request, this.service())
    }
    return apiRouter.fetch(request, this.env, this.ctx)
  }

  health(): Promise<BackendHealthDto> {
    // This is an RPC liveness sentinel, not dependency readiness. It must stay
    // independent from the database, secrets, queues, and external providers.
    const health: BackendHealthDto = {
      status: "ok",
      service: "api",
      entrypoint: "rpc",
    }
    return this.run("health", undefined, () => Promise.resolve(health))
  }

  // RPC currently has no trustworthy client-IP context. Credential throttling
  // remains a gate for the future web BFF/auth cutover; do not key it by the
  // caller-supplied email or actor.
  authenticateCredentials(input: { email: string; password: string }) {
    return this.run("authenticate_credentials", undefined, () => {
      const parsed = AuthenticateCredentialsRpcInputSchema.safeParse(input)
      if (!parsed.success) return Promise.resolve(null)
      return this.service().authenticateCredentials(parsed.data)
    })
  }

  registerUser(input: { email: string; password: string }) {
    return this.run("register_user", undefined, () =>
      this.service().registerUser(
        parseRpcInput(RegisterUserRpcInputSchema, input)
      )
    )
  }

  getProductAccess(actor: RpcActor) {
    return this.runForActor("get_product_access", actor, (parsedActor) =>
      this.service().getProductAccess(parsedActor)
    )
  }

  getProductShell(actor: RpcActor) {
    return this.runForActor("get_product_shell", actor, (parsedActor) =>
      this.service().getProductShell(parsedActor)
    )
  }

  listConversations(actor: RpcActor, input: ConversationListInput) {
    return this.runForActor(
      "list_conversations",
      actor,
      async (parsedActor) => {
        const parsedInput = parseRpcInput(ConversationListQuerySchema, input)
        const service = this.service()
        await service.getProductShell(parsedActor)
        return service.listConversations(parsedActor.userId, parsedInput)
      }
    )
  }

  getConversationThread(actor: RpcActor, input: ConversationThreadRpcInput) {
    return this.runForActor(
      "get_conversation_thread",
      actor,
      async (parsedActor) => {
        const parsedInput = parseRpcInput(
          ConversationThreadRpcInputSchema,
          input
        )
        const service = this.service()
        await service.getProductShell(parsedActor)
        return service.getConversationThread(
          parsedActor.userId,
          parsedInput.conversationId,
          {
            limit: parsedInput.limit ?? API_MAX_LIMIT,
            cursor: parsedInput.cursor,
          }
        )
      }
    )
  }

  listPages(actor: RpcActor) {
    return this.runForActor("list_pages", actor, async (parsedActor) => {
      const service = this.service()
      await service.getProductShell(parsedActor)
      return service.repository.listAllPages(parsedActor.userId)
    })
  }

  listAuthorizedMetaPages(actor: RpcActor) {
    return this.runForActor(
      "list_authorized_meta_pages",
      actor,
      (parsedActor) => this.service().listAuthorizedMetaPages(parsedActor)
    )
  }

  connectMetaPages(actor: RpcActor, input: ConnectMetaPagesInput) {
    return this.runForActor("connect_meta_pages", actor, (parsedActor) =>
      this.service().connectMetaPages(
        parsedActor,
        parseRpcInput(ConnectMetaPagesRpcInputSchema, input)
      )
    )
  }

  disconnectPage(actor: RpcActor, input: { pageId: string }) {
    return this.runForActor("disconnect_page", actor, (parsedActor) =>
      this.service().disconnectPage(
        parsedActor,
        parseRpcInput(PageIdRpcInputSchema, input).pageId
      )
    )
  }

  updatePageWebhook(
    actor: RpcActor,
    input: { pageId: string; webhookUrl: string | null }
  ) {
    return this.runForActor(
      "update_page_webhook",
      actor,
      async (parsedActor) => {
        const parsedInput = parseRpcInput(
          PageWebhookUpdateRpcInputSchema,
          input
        )
        const service = this.service()
        await service.getProductShell(parsedActor)
        return service.updatePageWebhookForRpc(
          parsedActor.userId,
          parsedInput.pageId,
          parsedInput.webhookUrl
        )
      }
    )
  }

  rotateWebhookSecret(actor: RpcActor, input: { pageId: string }) {
    return this.runForActor(
      "rotate_webhook_secret",
      actor,
      async (parsedActor) => {
        const parsedInput = parseRpcInput(PageIdRpcInputSchema, input)
        const service = this.service()
        await service.getProductShell(parsedActor)
        return service.rotateWebhookSecret(
          parsedActor.userId,
          parsedInput.pageId
        )
      }
    )
  }

  exchangeMetaAuthorizationCode(
    actor: RpcActor,
    input: { code: string; redirectUri: string }
  ) {
    return this.runForActor(
      "exchange_meta_authorization_code",
      actor,
      (parsedActor) =>
        this.service().exchangeMetaAuthorizationCode(
          parsedActor,
          parseRpcInput(MetaAuthorizationRpcInputSchema, input)
        )
    )
  }

  listApiKeys(actor: RpcActor) {
    return this.runForActor("list_api_keys", actor, (parsedActor) =>
      this.service().listApiKeys(parsedActor)
    )
  }

  createApiKey(actor: RpcActor, input: { label: string }) {
    return this.runForActor("create_api_key", actor, (parsedActor) =>
      this.service().createApiKey(
        parsedActor,
        parseRpcInput(ApiKeyCreateRpcInputSchema, input).label
      )
    )
  }

  revokeApiKey(actor: RpcActor, input: { apiKeyId: string }) {
    return this.runForActor("revoke_api_key", actor, (parsedActor) =>
      this.service().revokeApiKey(
        parsedActor,
        parseRpcInput(ApiKeyRevokeRpcInputSchema, input).apiKeyId
      )
    )
  }

  getBillingState(actor: RpcActor) {
    return this.runForActor("get_billing_state", actor, (parsedActor) =>
      this.service().getBillingState(parsedActor)
    )
  }

  createCheckoutSession(
    actor: RpcActor,
    input: { priceLookupKey: string; origin: string }
  ) {
    return this.runForActor("create_checkout_session", actor, (parsedActor) =>
      this.service().createCheckoutSession(
        parsedActor,
        parseRpcInput(CheckoutSessionRpcInputSchema, input)
      )
    )
  }

  createBillingPortalSession(actor: RpcActor, input: { origin: string }) {
    return this.runForActor(
      "create_billing_portal_session",
      actor,
      (parsedActor) =>
        this.service().createBillingPortalSession(
          parsedActor,
          parseRpcInput(BillingPortalSessionRpcInputSchema, input).origin
        )
    )
  }

  verifyCheckoutSession(actor: RpcActor, input: { sessionId: string }) {
    return this.runForActor("verify_checkout_session", actor, (parsedActor) =>
      this.service().verifyCheckoutSession(
        parsedActor,
        parseRpcInput(CheckoutVerificationRpcInputSchema, input).sessionId
      )
    )
  }

  changePassword(actor: RpcActor, input: { newPassword: string }) {
    return this.runForActor("change_password", actor, (parsedActor) =>
      this.service().changePassword(
        parsedActor,
        parseRpcInput(ChangePasswordRpcInputSchema, input).newPassword
      )
    )
  }

  deleteAccount(actor: RpcActor, input: { confirmEmail: string }) {
    return this.runForActor("delete_account", actor, (parsedActor) =>
      this.service().deleteAccount(
        parsedActor,
        parseRpcInput(DeleteAccountRpcInputSchema, input).confirmEmail
      )
    )
  }

  private service(): ApiService {
    return new ApiService(this.env)
  }

  private runForActor<T>(
    event: string,
    actor: RpcActor,
    operation: (actor: RpcActor) => Promise<T>
  ): Promise<T> {
    return this.run(event, actor, () =>
      operation(parseRpcInput(RpcActorSchema, actor))
    )
  }

  private async run<T>(
    event: string,
    actor: RpcActor | undefined,
    operation: () => Promise<T>
  ): Promise<T> {
    const startedAt = Date.now()
    try {
      const result = await operation()
      log("info", {
        entrypoint: "rpc",
        event,
        tenantId: rpcTenantId(actor),
        status: 200,
        durationMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      const contract =
        error instanceof ContractError
          ? error
          : new ContractError({
              code: "internal_error",
              message: "An unexpected error occurred.",
              status: 500,
            })
      log("error", {
        entrypoint: "rpc",
        event,
        tenantId: rpcTenantId(actor),
        status: contract.status,
        durationMs: Date.now() - startedAt,
        errorCode: contract.code,
      })
      throw contract
    }
  }
}

function privateHttpMethods(pathname: string): readonly string[] | undefined {
  switch (pathname) {
    case LEGACY_SEND_PATH:
      return ["POST"]
    case "/webhooks/meta":
      return ["GET", "POST"]
    case "/webhooks/stripe":
      return ["POST"]
    default:
      return undefined
  }
}

function parseRpcInput<T>(schema: ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data

  throw new ContractError({
    code: "validation_error",
    message: "RPC input is invalid.",
    status: 400,
    details: parsed.error.issues.map((issue) => ({
      path: issue.path.length
        ? issue.path.map((segment) => String(segment)).join(".")
        : "input",
      message: issue.message,
    })),
  })
}

function rpcTenantId(actor: unknown): string | undefined {
  const parsed = RpcActorSchema.safeParse(actor)
  return parsed.success ? parsed.data.userId : undefined
}

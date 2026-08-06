import { WorkerEntrypoint } from "cloudflare:workers"
import type {
  ConnectInstagramAccountInput,
  ConnectMetaPagesInput,
  ConversationListInput,
  RpcActor,
  WebAppApiContract,
} from "@workspace/contracts"
import { ContractError } from "@workspace/contracts"

import { ApiService } from "../application/service"
import { log } from "../observability/logger"

export class WebAppApi
  extends WorkerEntrypoint<Env>
  implements WebAppApiContract
{
  authenticateCredentials(input: { email: string; password: string }) {
    return this.run("authenticate_credentials", undefined, () =>
      this.service().authenticateCredentials(input)
    )
  }

  registerUser(input: { email: string; password: string }) {
    return this.run("register_user", undefined, () =>
      this.service().registerUser(input)
    )
  }

  getProductAccess(actor: RpcActor) {
    return this.run("get_product_access", actor, () =>
      this.service().getProductAccess(actor)
    )
  }

  getProductShell(actor: RpcActor) {
    return this.run("get_product_shell", actor, () =>
      this.service().getProductShell(actor)
    )
  }

  listConversations(actor: RpcActor, input: ConversationListInput) {
    return this.run("list_conversations", actor, async () => {
      const service = this.service()
      await service.getProductShell(actor)
      return service.listConversations(actor.userId, input)
    })
  }

  getConversationThread(actor: RpcActor, input: { conversationId: string }) {
    return this.run("get_conversation_thread", actor, async () => {
      const service = this.service()
      await service.getProductShell(actor)
      return service.getConversationThread(actor.userId, input.conversationId, {
        limit: 100,
      })
    })
  }

  listPages(actor: RpcActor) {
    return this.run("list_pages", actor, async () => {
      const service = this.service()
      await service.getProductShell(actor)
      return service.repository.listAllPages(actor.userId)
    })
  }

  listAuthorizedMetaPages(actor: RpcActor) {
    return this.run("list_authorized_meta_pages", actor, () =>
      this.service().listAuthorizedMetaPages(actor)
    )
  }

  connectMetaPages(actor: RpcActor, input: ConnectMetaPagesInput) {
    return this.run("connect_meta_pages", actor, () =>
      this.service().connectMetaPages(actor, input)
    )
  }

  disconnectPage(actor: RpcActor, input: { pageId: string }) {
    return this.run("disconnect_page", actor, () =>
      this.service().disconnectPage(actor, input.pageId)
    )
  }

  updatePageWebhook(
    actor: RpcActor,
    input: { pageId: string; webhookUrl: string | null }
  ) {
    return this.run("update_page_webhook", actor, async () => {
      const service = this.service()
      await service.getProductShell(actor)
      return service.updatePageWebhook(
        actor.userId,
        input.pageId,
        input.webhookUrl
      )
    })
  }

  exchangeMetaAuthorizationCode(
    actor: RpcActor,
    input: { code: string; redirectUri: string }
  ) {
    return this.run("exchange_meta_authorization_code", actor, () =>
      this.service().exchangeMetaAuthorizationCode(actor, input)
    )
  }

  // Un solo método y no dos como en Facebook: Instagram Login autoriza una
  // cuenta, así que entre el intercambio y la conexión no hay nada que elegir.
  connectInstagramAccount(
    actor: RpcActor,
    input: ConnectInstagramAccountInput
  ) {
    return this.run("connect_instagram_account", actor, () =>
      this.service().connectInstagramAccount(actor, input)
    )
  }

  listApiKeys(actor: RpcActor) {
    return this.run("list_api_keys", actor, () =>
      this.service().listApiKeys(actor)
    )
  }

  createApiKey(actor: RpcActor, input: { label: string }) {
    return this.run("create_api_key", actor, () =>
      this.service().createApiKey(actor, input.label)
    )
  }

  revokeApiKey(actor: RpcActor, input: { apiKeyId: string }) {
    return this.run("revoke_api_key", actor, () =>
      this.service().revokeApiKey(actor, input.apiKeyId)
    )
  }

  getBillingState(actor: RpcActor) {
    return this.run("get_billing_state", actor, () =>
      this.service().getBillingState(actor)
    )
  }

  createCheckoutSession(
    actor: RpcActor,
    input: { priceLookupKey: string; returnUrl: string }
  ) {
    return this.run("create_checkout_session", actor, () =>
      this.service().createCheckoutSession(actor, input)
    )
  }

  createBillingPortalSession(actor: RpcActor, input: { returnUrl: string }) {
    return this.run("create_billing_portal_session", actor, () =>
      this.service().createBillingPortalSession(actor, input.returnUrl)
    )
  }

  verifyCheckoutSession(actor: RpcActor, input: { sessionId: string }) {
    return this.run("verify_checkout_session", actor, () =>
      this.service().verifyCheckoutSession(actor, input.sessionId)
    )
  }

  changePassword(actor: RpcActor, input: { newPassword: string }) {
    return this.run("change_password", actor, () =>
      this.service().changePassword(actor, input.newPassword)
    )
  }

  deleteAccount(actor: RpcActor, input: { confirmEmail: string }) {
    return this.run("delete_account", actor, () =>
      this.service().deleteAccount(actor, input.confirmEmail)
    )
  }

  private service(): ApiService {
    return new ApiService(this.env)
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
        tenantId: actor?.userId,
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
        tenantId: actor?.userId,
        status: contract.status,
        durationMs: Date.now() - startedAt,
        errorCode: contract.code,
      })
      throw contract
    }
  }
}

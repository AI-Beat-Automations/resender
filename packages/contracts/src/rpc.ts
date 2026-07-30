import type {
  ConversationListDto,
  ConversationListInput,
  ConversationThreadDto,
  PageDto,
} from "./schemas/api"
import type {
  AccountDeletionResultDto,
  ApiKeyDto,
  AuthenticatedUserDto,
  AuthorizedMetaPageDto,
  BillingStateDto,
  CheckoutVerificationDto,
  ConnectMetaPagesInput,
  CreatedApiKeyDto,
  MetaAuthorizationResultDto,
  MetaPageSelectionDto,
  ProductAccessDto,
  ProductShellDto,
  RpcActor,
} from "./schemas/rpc"

export interface WebAppApiContract {
  authenticateCredentials(input: {
    email: string
    password: string
  }): Promise<AuthenticatedUserDto | null>

  registerUser(input: {
    email: string
    password: string
  }): Promise<AuthenticatedUserDto>

  getProductAccess(actor: RpcActor): Promise<ProductAccessDto>
  getProductShell(actor: RpcActor): Promise<ProductShellDto>

  listConversations(
    actor: RpcActor,
    input: ConversationListInput
  ): Promise<ConversationListDto>

  getConversationThread(
    actor: RpcActor,
    input: { conversationId: string }
  ): Promise<ConversationThreadDto>

  listPages(actor: RpcActor): Promise<PageDto[]>
  listAuthorizedMetaPages(actor: RpcActor): Promise<MetaPageSelectionDto>
  connectMetaPages(
    actor: RpcActor,
    input: ConnectMetaPagesInput
  ): Promise<PageDto[]>
  disconnectPage(actor: RpcActor, input: { pageId: string }): Promise<PageDto>
  updatePageWebhook(
    actor: RpcActor,
    input: { pageId: string; webhookUrl: string | null }
  ): Promise<PageDto>
  exchangeMetaAuthorizationCode(
    actor: RpcActor,
    input: { code: string; redirectUri: string }
  ): Promise<MetaAuthorizationResultDto>

  listApiKeys(actor: RpcActor): Promise<ApiKeyDto[]>
  createApiKey(
    actor: RpcActor,
    input: { label: string }
  ): Promise<CreatedApiKeyDto>
  revokeApiKey(actor: RpcActor, input: { apiKeyId: string }): Promise<void>

  getBillingState(actor: RpcActor): Promise<BillingStateDto>
  createCheckoutSession(
    actor: RpcActor,
    input: { priceLookupKey: string; returnUrl: string }
  ): Promise<{ url: string }>
  createBillingPortalSession(
    actor: RpcActor,
    input: { returnUrl: string }
  ): Promise<{ url: string }>
  verifyCheckoutSession(
    actor: RpcActor,
    input: { sessionId: string }
  ): Promise<CheckoutVerificationDto>

  changePassword(actor: RpcActor, input: { newPassword: string }): Promise<void>
  deleteAccount(
    actor: RpcActor,
    input: { confirmEmail: string }
  ): Promise<AccountDeletionResultDto>
}

export type { AuthorizedMetaPageDto }

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
  ConnectInstagramAccountInput,
  ConnectMetaPagesInput,
  ConnectWhatsappNumberInput,
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

  // Sin gemelo de `listAuthorizedMetaPages`: Instagram Login devuelve una sola
  // cuenta, así que no hay pantalla de selección y este método hace el flujo
  // entero.
  connectInstagramAccount(
    actor: RpcActor,
    input: ConnectInstagramAccountInput
  ): Promise<PageDto>

  // Como Instagram, sin pantalla de selección: Embedded Signup autoriza un
  // número concreto y el método completa el flujo entero (exchange, validación
  // de assets, registro/suscripción según `mode` y persistencia).
  connectWhatsappNumber(
    actor: RpcActor,
    input: ConnectWhatsappNumberInput
  ): Promise<PageDto>

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

import type {
  ConversationListDto,
  ConversationListInput,
  ConversationThreadDto,
  WebhookSecretDto,
} from "./schemas/api"
import type {
  AccountDeletionResultDto,
  ApiKeyCreateRpcInput,
  ApiKeyDto,
  ApiKeyRevokeRpcInput,
  AuthenticateCredentialsRpcInput,
  AuthenticatedUserDto,
  AuthorizedMetaPageDto,
  BackendHealthDto,
  BillingPortalSessionRpcInput,
  BillingStateDto,
  ChangePasswordRpcInput,
  CheckoutSessionRpcInput,
  CheckoutVerificationDto,
  CheckoutVerificationRpcInput,
  ConversationThreadRpcInput,
  ConnectMetaPagesInput,
  CreatedApiKeyDto,
  DeleteAccountRpcInput,
  MetaAuthorizationRpcInput,
  MetaAuthorizationResultDto,
  MetaPageSelectionDto,
  PageIdRpcInput,
  PageWebhookUpdateRpcInput,
  ProductAccessDto,
  ProductShellDto,
  RegisterUserRpcInput,
  RpcActor,
  RpcPageDto,
  StripeRedirectDto,
} from "./schemas/rpc"

export interface WebAppApiContract {
  health(): Promise<BackendHealthDto>

  authenticateCredentials(
    input: AuthenticateCredentialsRpcInput
  ): Promise<AuthenticatedUserDto | null>

  registerUser(input: RegisterUserRpcInput): Promise<AuthenticatedUserDto>

  getProductAccess(actor: RpcActor): Promise<ProductAccessDto>
  getProductShell(actor: RpcActor): Promise<ProductShellDto>

  listConversations(
    actor: RpcActor,
    input: ConversationListInput
  ): Promise<ConversationListDto>

  getConversationThread(
    actor: RpcActor,
    input: ConversationThreadRpcInput
  ): Promise<ConversationThreadDto>

  listPages(actor: RpcActor): Promise<RpcPageDto[]>
  listAuthorizedMetaPages(actor: RpcActor): Promise<MetaPageSelectionDto>
  connectMetaPages(
    actor: RpcActor,
    input: ConnectMetaPagesInput
  ): Promise<RpcPageDto[]>
  disconnectPage(actor: RpcActor, input: PageIdRpcInput): Promise<RpcPageDto>
  updatePageWebhook(
    actor: RpcActor,
    input: PageWebhookUpdateRpcInput
  ): Promise<RpcPageDto>
  rotateWebhookSecret(
    actor: RpcActor,
    input: PageIdRpcInput
  ): Promise<WebhookSecretDto>
  exchangeMetaAuthorizationCode(
    actor: RpcActor,
    input: MetaAuthorizationRpcInput
  ): Promise<MetaAuthorizationResultDto>

  listApiKeys(actor: RpcActor): Promise<ApiKeyDto[]>
  createApiKey(
    actor: RpcActor,
    input: ApiKeyCreateRpcInput
  ): Promise<CreatedApiKeyDto>
  revokeApiKey(actor: RpcActor, input: ApiKeyRevokeRpcInput): Promise<ApiKeyDto>

  getBillingState(actor: RpcActor): Promise<BillingStateDto>
  createCheckoutSession(
    actor: RpcActor,
    input: CheckoutSessionRpcInput
  ): Promise<StripeRedirectDto>
  createBillingPortalSession(
    actor: RpcActor,
    input: BillingPortalSessionRpcInput
  ): Promise<StripeRedirectDto>
  verifyCheckoutSession(
    actor: RpcActor,
    input: CheckoutVerificationRpcInput
  ): Promise<CheckoutVerificationDto>

  changePassword(actor: RpcActor, input: ChangePasswordRpcInput): Promise<void>
  deleteAccount(
    actor: RpcActor,
    input: DeleteAccountRpcInput
  ): Promise<AccountDeletionResultDto>
}

export type { AuthorizedMetaPageDto }

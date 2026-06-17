## Problem Statement

Echo ya puede completar el flujo base de Meta a nivel técnico, pero todavía no existe un MVP de producto usable para tenants reales. Hoy no hay autenticación propia, no existe persistencia, los page access tokens y los mensajes viven en memoria, la API externa de salida no está protegida, y la app no separa claramente onboarding, conexiones y bitácora. Desde la perspectiva del usuario, esto significa que todavía no puede crear una cuenta, iniciar sesión, conectar sus páginas de forma durable, configurar su automatización externa con credenciales seguras ni consultar un historial confiable de mensajes entrantes y salientes.

## Solution

Construir un MVP multi-tenant donde cada usuario pueda registrarse con email y password, iniciar sesión con Auth.js, conectar una o varias páginas de Facebook desde una pantalla dedicada de Connections, configurar por página una `webhookUrl` para push de mensajes entrantes, administrar API keys opacas desde Settings para que su sistema externo pueda responder, y consultar una bitácora persistente de conversaciones en Messages. El producto debe preservar el modelo de Echo como gateway + bitácora: recibir y persistir mensajes, reenviarlos al sistema externo, aceptar respuestas vía API externa segura, y mostrar toda la conversación con dirección y estado.

## User Stories

1. As a prospective customer, I want a public landing page, so that I can understand what Echo does before creating an account.
2. As a prospective customer, I want clear Login and Register entry points, so that I can access the product without confusion.
3. As a new customer, I want to register with only email and password, so that I can start onboarding quickly.
4. As a new customer, I want to enter the product immediately after register, so that I do not need email verification during the MVP.
5. As a returning customer, I want to log in with my credentials, so that I can continue managing my messaging setup.
6. As a returning customer, I want generic login errors, so that the product does not reveal whether an email exists.
7. As a user creating an account, I want to be told explicitly when my email is already registered, so that I can recover context and log in instead.
8. As an authenticated customer, I want to be redirected away from Login and Register, so that I land in the actual product instead of auth screens.
9. As an unauthenticated visitor, I want protected product routes to send me to Login, so that access control is enforced consistently.
10. As a newly authenticated customer, I want to land in Connections, so that I can complete the next mandatory step of connecting Facebook.
11. As a customer, I want a dedicated Connections screen, so that Meta onboarding is separated from general account settings.
12. As a customer, I want to connect Facebook from Connections, so that I can authorize my pages with one clear flow.
13. As a customer who administers multiple Facebook pages, I want Echo to connect all authorized pages automatically, so that onboarding is fast and does not require a second selection step.
14. As a customer, I want Echo to remember my connected pages after restart or redeploy, so that I do not lose access tokens or configuration.
15. As a customer, I want an existing page reconnection to refresh its token and metadata, so that reconnecting repairs credentials without duplicating data.
16. As a customer, I want Echo to block connecting a page that already belongs to another tenant, so that cross-tenant takeover is impossible.
17. As a customer, I want to see all pages I have connected, so that I understand which channels are active.
18. As a customer, I want to configure a separate `webhookUrl` per page, so that each page can route inbound traffic to the correct external automation.
19. As a customer, I want page webhook configuration to save only when I press Guardar, so that partial or accidental URLs are not persisted.
20. As a customer, I want to disconnect a page with an explicit confirmation, so that I do not accidentally stop message traffic.
21. As a customer, I want disconnecting a page to preserve its historical messages, so that Echo remains a durable bitácora.
22. As a customer, I want inbound messages to be persisted even if no external `webhookUrl` is configured, so that I never lose the message log.
23. As a customer, I want Echo to push inbound messages to my external system after persisting them, so that my automation can react in near real time.
24. As a customer, I want Echo to respond quickly to Meta even if my external webhook is slow or broken, so that Messenger delivery stays healthy.
25. As a customer, I want push failures to my external system not to delete inbound messages, so that my historical record stays trustworthy.
26. As an external automation, I want a rich inbound payload with tenant, page, conversation, and message context, so that I can process messages without extra lookups.
27. As a customer, I want a dedicated Settings screen for account and API keys, so that I can manage credentials without mixing them with Meta connections.
28. As a customer, I want to create multiple API keys with labels, so that I can distinguish different external automations.
29. As a customer, I want API keys to live until I revoke them, so that long-running automations do not break due to forced expiration.
30. As a customer, I want API keys to be shown only once on creation, so that the product can store only hashes and still protect secrets.
31. As a customer, I want revoked API keys to remain visible with status, so that I retain operational history.
32. As a customer, I want to see metadata such as label, visible prefix, creation date, last use, and status for each API key, so that I can manage them confidently.
33. As an external automation, I want to authenticate using a simple opaque API key, so that integration with N8N or custom logic is straightforward.
34. As an external automation, I want the same API key to work across all pages of the same tenant, so that I do not need per-page credentials in the MVP.
35. As an external automation, I want to call a protected send endpoint with `pageId`, `recipientId`, and `reply`, so that I can send Messenger responses through Echo.
36. As an external automation, I want to send an optional `conversationId`, so that Echo can persist outgoing messages with better traceability.
37. As an external automation, I want Echo to reject inconsistent `conversationId` values, so that bugs are caught early instead of corrupting message history.
38. As a customer, I want outgoing responses to be persisted whether Meta accepts or rejects them, so that the bitácora includes both successes and failures.
39. As a customer, I want outgoing failed messages to remain visually identifiable as outbound while still showing failure state, so that I can distinguish direction from delivery result.
40. As a customer, I want a Messages screen organized by conversation and thread, so that the bitácora scales beyond a flat event log.
41. As a customer, I want conversations ordered by most recent activity, so that I see the hottest thread first.
42. As a customer, I want the most recent conversation to open automatically, so that I start with the most relevant context.
43. As a customer with multiple pages, I want Messages to show all conversations by default with a page filter, so that I can operate globally or focus per page.
44. As a customer, I want each conversation to show which page it belongs to, so that multi-page operation stays understandable.
45. As a customer, I want Echo to identify contacts by PSID when no real contact name is available, so that the conversation list still works before profile enrichment exists.
46. As a customer, I want Echo to preserve the gateway + bitácora model, so that I do not need an interactive agent UI to operate the product.
47. As a product owner, I want the MVP to use minimal user profile data, so that the auth model stays simple and easy to evolve.
48. As a product owner, I want the external API auth model to be revocable centrally, so that leaked credentials can be invalidated quickly.
49. As a product owner, I want the data model to separate users, pages, conversations, messages, and API keys, so that future changes stay modular.
50. As a developer, I want deep modules around auth, API keys, page ownership, inbound ingestion, outbound dispatch, and read models, so that the implementation stays testable and less coupled to route handlers.

## Implementation Decisions

- Web authentication uses Auth.js for the Next.js app.
- The MVP exposes separate `/login` and `/register` routes.
- Register allows immediate access after signup; email verification is explicitly out of scope for the MVP.
- Protected product routes include at least Connections, Messages, and Settings.
- Authenticated users visiting Login or Register are redirected to Connections.
- The post-auth landing route is Connections because connecting Meta is the next required operational step.
- The root route remains a public landing page with product messaging and entry points to Login and Register.
- The user model remains minimal: only identity and credential fields required by the product, plus any strictly necessary Auth.js integration fields.
- Password policy is intentionally minimal for the MVP: valid email plus password length of at least 8 characters.
- Login errors are generic; duplicate email errors in register are explicit.
- Password reset and password recovery are out of scope for the MVP.
- The app remains multi-tenant with `tenantId = userId`.
- Meta page ownership is exclusive: a page can belong to only one tenant at a time.
- If a user reconnects a page they already own, the operation is idempotent and refreshes the encrypted token and page metadata.
- If another tenant attempts to connect an already-owned page, the operation is blocked rather than transferred automatically.
- A tenant may connect multiple Facebook pages in the MVP.
- When Meta returns multiple authorized pages during callback, Echo connects all of them automatically for that same tenant.
- Page management lives in Connections, not in Settings.
- Settings is reserved for account-level concerns and API key management.
- Each page can store its own `webhookUrl` for outbound push to the external system.
- Page `webhookUrl` editing uses explicit save actions rather than autosave.
- Disconnecting a page requires confirmation and stops future traffic for that page while preserving historical conversations and messages.
- Inbound message delivery to the external system uses push, not polling, in the MVP.
- The inbound workflow is: verify Meta request, resolve tenant by page, persist conversation/message state, acknowledge Meta quickly, then attempt non-blocking push to the page-specific external `webhookUrl`.
- If a page has no `webhookUrl`, Echo still persists the message and exposes it in Messages.
- If the external push fails, Echo records the failure but does not retry automatically in the MVP.
- The external inbound payload includes minimal but rich context for tenant, page, conversation, and message.
- External outbound authentication does not use JWT. It uses opaque API keys only.
- API keys are created and revoked in Settings.
- A tenant may have multiple API keys, each identified by a user-defined label.
- API keys do not expire automatically in the MVP; they remain valid until manual revocation.
- API keys are shown only once at creation time.
- Persisted API key storage uses one-way hashing of the secret rather than storing the full credential.
- The visible token format is a readable prefix plus a random secret, such as `pk_live_<secret>`.
- API keys remain visible in Settings after revocation with metadata and revoked status.
- Each API key authorizes access to all pages belonging to its tenant in the MVP.
- The external send API authenticates via `Authorization: Bearer <api-key>`.
- The external send API accepts `pageId`, `recipientId`, and `reply`, and may also accept `conversationId`.
- If `conversationId` is present, it must match the provided page and recipient context or the request is rejected.
- Outgoing responses are persisted whether Meta accepts or rejects the send attempt.
- Message persistence distinguishes direction from delivery result.
- Messages uses conversations as the primary read model and threads as the primary reading surface.
- Conversations are ordered by latest activity descending.
- Messages opens the most recent conversation by default.
- Messages shows all pages by default and allows filtering by page.
- Until contact-name enrichment exists, contact identity is displayed using PSID/contact ID in a human-usable format.
- The core deep modules to build or refactor are: credentials-based user auth, opaque API key lifecycle, page registry and ownership rules, inbound webhook ingestion, outbound external push orchestration, outbound Meta send orchestration, and conversations/messages read queries.
- Route handlers and pages should stay thin orchestration layers over those deeper modules.
- New persistence is required for users, pages, conversations, messages, and API keys.
- Web sessions should use JWT strategy for browser auth; external machine auth remains API-key based.
- Token-at-rest encryption remains required for page access tokens.
- The persistent data layer replaces the current in-memory page token store and in-memory message store as sources of truth.
- Real-time streaming may remain an in-memory fan-out mechanism for the live UX, but it no longer owns the authoritative data.

## Testing Decisions

- Good tests must verify externally observable behavior and business rules, not implementation details.
- Tests should focus on stable interfaces such as auth outcomes, API key creation and revocation behavior, page ownership rules, inbound ingestion effects, outbound send validation, and messages read ordering.
- The first wave of tests should cover the deepest modules because they encapsulate the rules that matter most and are easiest to validate in isolation.
- The auth module should be tested for successful register/login, duplicate email handling, generic login failures, and route guard behavior.
- The API key module should be tested for label creation, one-time secret reveal semantics, hash persistence behavior, tenant scoping, revocation, and last-used tracking.
- The page registry module should be tested for same-tenant reconnection, cross-tenant ownership blocking, multi-page auto-connect, disconnect semantics, and per-page webhook updates.
- The inbound ingestion module should be tested for Meta signature validation, page-to-tenant resolution, conversation upsert behavior, message persistence, and non-blocking push behavior when the external webhook is missing or failing.
- The outbound dispatch module should be tested for API-key authentication, tenant-page ownership checks, optional `conversationId` validation, and persistence of both `sent` and `failed` outgoing messages.
- The messages read model should be tested for conversation ordering, latest-conversation default selection, page filtering, and fallback display using PSID/contact ID.
- A small number of route-level integration tests should verify that the thin HTTP surfaces correctly wire requests into the deep modules and return the expected status codes.
- There is no meaningful prior art for tests in the current codebase because the repository currently has no automated tests. This PRD should establish the first testing patterns for the project.

## Out of Scope

- Email verification.
- Password reset and forgot-password flows.
- Interactive chat reply composition in the UI.
- Per-page or per-scope API key permissions beyond tenant-wide access.
- Automatic retries, queues, or worker-based backoff for failed external push delivery.
- Contact-name enrichment from Meta profiles.
- Instagram support.
- Human agent tag handling outside the 24-hour Messenger response window.
- Pull-based message ingestion by external systems.
- Hard deletion of historical messages during page disconnect.
- Business verification, app review, and production compliance work beyond what is strictly needed for the MVP code path.

## Further Notes

- The current repository already contains working Meta OAuth by redirection, webhook signature verification, a live-event stream, and a temporary send endpoint, but all durable state is still missing.
- The current implementation stores page tokens and messages only in memory, so persistence is the largest architectural gap between the current codebase and the MVP.
- The previous product draft assumed JWT authentication for the external send API; this PRD supersedes that assumption and standardizes on opaque API keys for machine-to-machine access.
- The Messages surface remains a bitácora, not an interactive operator console. Outgoing messages continue to originate from the external system through Echo's API.
- The MVP should preserve quick acknowledgment to Meta as a non-negotiable operational requirement.
- Node-runtime compatibility remains important for crypto-backed token encryption and other server-only concerns.

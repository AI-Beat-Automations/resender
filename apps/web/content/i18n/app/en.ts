import type { AppDict } from "./dictionary"

// El inglés del producto. Mismo registro que el español de la consola: directo,
// segunda persona, sin exclamaciones. Los identificadores técnicos que el
// usuario cita en soporte (`tenant_id`, `page_id`, `waba_id`, los nombres de las
// cabeceras) no se traducen: son literales, no copy.
export const en: AppDict = {
  intl: "en-US",

  common: {
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    copy: "Copy",
    copied: "Copied",
    dismissNotice: "Dismiss this notice",
    contactEmail: "info@resender.dev",
  },

  shell: {
    home: "Resender.dev — home",
    navConnections: "Connections",
    navInbox: "Inbox",
    navSettings: "Settings",
    navDocs: "Documentation",
    theme: "theme",
    signOut: "Sign out",
  },

  quota: {
    warningTitle: "You're close to your limit.",
    warningBody:
      "You've used {usage} of the {limit} messages in your plan for this billing period.",
    restrictedTitle: "Account restricted.",
    blockedPageLimit:
      "Your plan allows {maxPages} connections and you have {activePageCount}. Disconnect connections to start sending again.",
    blockedQuota:
      "You've used up the {limit} messages in your plan for this billing period. Upgrade your plan to start sending again.",
    blockedPlanUnavailable:
      "We couldn't resolve your plan's limits. This isn't something you can fix from your account: we're looking into it.",
    blockedDefault:
      "Your account stopped sending messages. Check your subscription to resume it.",
    ctaManagePages: "Manage pages",
    ctaContact: "Contact us",
    ctaUpgrade: "Upgrade plan",
  },

  channels: {
    label: {
      messenger: "Messenger",
      instagram: "Instagram",
      whatsapp: "WhatsApp",
    },
    noun: {
      messenger: "this page",
      instagram: "this account",
      whatsapp: "this number",
    },
    tokenInvalidBody: {
      messenger:
        "Meta rejected this page's token. Reconnect it from Facebook to renew permissions before sending replies again.",
      instagram:
        "Meta rejected this account's token. Authorize it again on Instagram to renew it before sending more replies.",
      whatsapp:
        "Meta rejected this number's token. Run the Embedded Signup again to renew it: until then, nothing comes in or goes out through this number.",
    },
    onboardingMode: {
      standard: "new number (standard)",
      coexistence: "existing number (Coexistence)",
    },
    historySync: {
      not_requested: {
        label: "history: not requested",
        body: "We haven't requested the history from Meta yet. The 24-hour window since the connection is already running: if it runs out without syncing, the connection has to be redone.",
        actionLabel: null,
      },
      requested: {
        label: "history: requested",
        body: "We asked Meta for the history and we're waiting for the first batch. There's nothing you need to do.",
        actionLabel: null,
      },
      in_progress: {
        label: "history: importing",
        body: "The history is arriving in batches. Conversations show up in the Inbox as they're imported.",
        actionLabel: null,
      },
      complete: {
        label: "history: complete",
        body: "The import finished. If the business chose not to share its history, it's normal that no old conversations showed up.",
        actionLabel: null,
      },
      failed: {
        label: "history: failed",
        body: "We couldn't import the history: we ran out of retries against Meta. Run the Coexistence signup again to request it once more, while the 24-hour window is still open.",
        actionLabel: "Redo the Coexistence signup",
      },
      expired: {
        label: "history: expired",
        body: "The 24-hour window has passed and the connection has to be redone from the Embedded Signup. Meta cancels the onboarding when the history doesn't sync within that window, and there's no way to resume it.",
        actionLabel: "Redo from the Embedded Signup",
      },
    },
    coexistenceLimits: [
      "A hard ceiling of 20 messages per second: a Coexistence number doesn't scale by messaging tier, no matter how much volume the account has.",
      "Eligibility is Meta's call: the country, the number, the account, the WhatsApp Business App version or the device can rule it out, and there's no published list.",
    ],
    statusBadge: {
      active: "active",
      "no-access": "no access",
      disconnected: "disconnected",
    },
  },

  connections: {
    eyebrow: "connections",
    title: "Connections",
    subtitle:
      "Connect your Facebook pages, your Instagram accounts and your WhatsApp numbers, set a webhook per account, and disconnect channels without deleting history.",
    connectFacebook: "Connect Facebook",
    connectInstagram: "Connect Instagram",
    connectWhatsapp: "Connect WhatsApp",
    whatsappEntryDescription:
      "Meta opens its window and you choose there: register a new number, or connect the one you already use in the WhatsApp Business app. The choice matters —each option leaves the number in a different state— and we'll tell you what it means as soon as the window closes.",
    whatsappModeCaveat: {
      standard:
        "You registered a new number on the WhatsApp API: it's now registered for the API and can no longer be used from the WhatsApp Business app.",
      coexistence:
        "You connected the number you already use in the WhatsApp Business app: it keeps working there and also reaches Resender. Meta decides eligibility, and the number gets a hard ceiling of 20 messages per second. The history has to be synced within the next 24 hours.",
    },
    connectedAccountsHeading: "CONNECTED ACCOUNTS",
    quota: "{activePageCount} of {maxPages} connections",
    quotaUnresolved: "quota unresolved · write to info@resender.dev",
    noticeConnectedGeneric: "Connected: the authorization completed.",
    noticeInstagramNamed:
      "Connected: the Instagram account @{username} is now authorized.",
    noticeInstagram: "Connected: the Instagram account is now authorized.",
    noticeConnectedOne: "Connected: 1 page authorized — {list}.",
    noticeConnectedMany: "Connected: {count} pages authorized — {list}.",
    listConjunction: "and",
    empty: {
      facebookTitle: "Facebook",
      facebookBody:
        "Authorize your pages from Meta to start receiving messages.",
      instagramTitle: "Instagram",
      instagramBody:
        "Authorize your professional account to receive direct messages and comments. You don't need a Facebook page.",
      whatsappTitle: "WhatsApp",
      whatsappBody:
        "Register a new number, or connect the one you already use in the WhatsApp Business App without giving it up on your phone. You can only reply within 24 hours of the customer's last message.",
      title: "No accounts connected yet.",
      body: "Once you authorize an account it shows up here, with its webhook and its status. Reconnecting refreshes the token and the metadata without duplicating accounts.",
      step1: "1 · authorize the account",
      step2: "2 · point your webhook",
      step3: "3 · the first message arrives",
    },
  },

  connectionCard: {
    connectedOn: "connected on",
    reconnect: "Reconnect",
    reconnectAgain: "Connect again",
    disconnect: "Disconnect",
    tokenInvalidBadge: "invalid token",
    noAccessTitle: "The {channel} channel isn't enabled for your account.",
    noAccessBody:
      "The connection is still in place and its history is available, but it doesn't receive new messages and can't reply. Write to info@resender.dev to have it enabled.",
    tokenInvalidTitle: "You need to reconnect {noun}.",
    tokenErrorDetectedOn: "detected on {date}",
    whatsappOnboardingLabel: "signup:",
    whatsappOnboardingUnknown: "not registered",
    whatsappTokenLabel: "token:",
    whatsappTokenValid: "valid",
    whatsappTokenRejected: "rejected by Meta",
    whatsappSubscriptionLabel: "subscription:",
    whatsappSubscriptionUnknown: "no data",
    coexistenceLimitsTitle: "Coexistence limits",
    pinTitle: "Two-step verification",
    pinBody:
      "When we registered this number we turned on two-step verification with a PIN we generated. Meta never shows it again: you need this PIN to register the number again, here or on any other platform.",
    pinReveal: "Show PIN",
    pinRevealing: "Retrieving…",
    pinHide: "Hide",
    pinError: "We couldn't retrieve the PIN right now. Please try again.",
    webhookLabel: "Webhook URL",
    webhookPlaceholder: "https://your-automation.example/webhook",
    webhookHint: "Every incoming message is forwarded as a POST to this URL.",
    signingSecretLabel: "Signing secret",
    rotate: "Rotate",
    rotating: "Rotating…",
    generate: "Generate",
    secretRevealTitle: "Copy it now: it won't be shown again.",
    secretWithBody:
      "Every POST carries the resender-signature, resender-event-id and resender-timestamp headers. Rotating invalidates the previous secret.",
    secretWithoutBody:
      "No signature yet: the receiver can't verify that the POST comes from Resender.",
    disconnectedOn: "Disconnected on {date}. ",
    disconnectedNoDate: "Disconnected. ",
    disconnectedHistoryKept:
      "The history is still available in the message log.",
    disconnectTitle: "Disconnect {name}?",
    disconnectBody:
      "It will stop receiving new traffic, but the history is kept. You can connect it again later.",
    disconnectConfirm: "Yes, disconnect",
    disconnecting: "Disconnecting…",
  },

  select: {
    eyebrow: "connections",
    title: "Choose pages",
    subtitle:
      "Choose which of the pages you manage on Facebook you want to connect to Resender.",
    back: "Back to Connections without connecting anything",
    noAuthTitle: "You haven't authorized your pages on Meta yet.",
    noAuthBody:
      "We need your authorization to list the pages you manage. Connect Facebook and come back here to choose which ones to connect.",
    planUnresolvedTitle: "We couldn't resolve your plan's limits.",
    planUnresolvedBody:
      "Write to info@resender.dev so we can review your subscription before you connect pages.",
    planHeading: "Your plan",
    planUsage: "You have {activePageCount} of {maxPages} connections.",
    allowanceOne: "You can add {count} more page.",
    allowanceMany: "You can add {count} more pages.",
    allowanceNone:
      "You're out of quota: disconnect a page to free up a slot and connect another one.",
    emptyTitle: "There are no pages you can connect yet.",
    emptyBody:
      "Meta didn't return any page you manage. Check that you gave it access to your pages and connect Facebook again.",
    listHeading: "PAGES YOU MANAGE",
    badgeConnected: "already connected",
    badgeForeign: "on another account",
    foreignBody:
      "It's already connected on another Resender account. A page belongs to a single account.",
    connectedBody: "You already have it connected and active.",
    addOnlyHint:
      "This screen only adds pages: unchecking a connected page never disconnects it.",
    atLimitHint:
      "You've already checked the {remainingSlots} your plan allows ({maxPages} connections in total). Uncheck one to pick another, or disconnect one to free up a slot.",
    submit: "Connect the selected pages",
    submitting: "Connecting…",
  },

  inbox: {
    eyebrow: "inbox",
    title: "Inbox",
    subtitle:
      "A durable log of messages and comments. Replies go out through the external API; this screen is read-only.",
    tabs: { mensajes: "Messages", comentarios: "Comments" },
    tabsAria: "Inbox mode",
    filterAll: "All accounts",
    conversationsHeading: "Conversations",
    publicationsHeading: "Posts",
    sortedByActivity: "Sorted by recent activity.",
    emptyConversations: "No conversations yet.",
    emptyConversationsFiltered: "No conversations for this filter.",
    emptyComments: "No comments yet.",
    emptyCommentsFiltered: "No comments for this filter.",
    readOnly: "read-only",
    readOnlyHint: "Replies go out through the external API",
    threadEmpty: "This conversation has no saved messages yet.",
    noConversationsTitle: "No conversations saved yet.",
    noConversationsFilteredTitle: "This account has no conversations yet.",
    noConversationsBody:
      "When someone writes to this account, the message is saved here and forwarded to your webhook.",
    noConversationsFilteredBody:
      "The filter didn't return any conversation. Try «All accounts» to see the rest of the log.",
    noCommentsTitle: "No comments saved yet.",
    noCommentsFilteredTitle: "This account has no comments yet.",
    noCommentsBody:
      "When someone comments on a post, the comment is saved here and forwarded to your webhook.",
    noCommentsFilteredBody:
      "The filter didn't return any post. Try «All accounts» to see the rest of the log.",
    noInstagramTitle: "No Instagram account connected yet.",
    noInstagramBody:
      "Comments only arrive through Instagram. Connect a professional account to see them here.",
    noInstagramCta: "Go to Connections",
    openInInstagram: "Open on Instagram",
    fromCommentTitle: "Sent as a private reply to an Instagram comment",
    deliveryTitle:
      "What Meta reports about delivery, different from the internal send status",
    reactionOutbound: "Reaction from the business",
    reactionInbound: "Reaction from the contact",
    imageAlt: "Image attachment",
    attachmentStatus: {
      pending: "downloading…",
      available: "preview / download",
      failed: "couldn't download",
      deleted: "file expired",
      unavailable: "WhatsApp doesn't keep files older than 14 days",
    },
  },

  log: {
    today: "today {time}",
    yesterday: "yesterday {time}",
    you: "You: ",
    noMessages: "No messages yet.",
    deliveryPrefix: "delivery: {status}",
    delivery: {
      accepted: "accepted",
      sent: "sent",
      delivered: "delivered",
      read: "read",
      failed: "not delivered",
      deleted: "deleted",
    },
    fromCommentSuffix: "reply to comment",
    replyingTo: "replying to {author}",
    commentCountOne: "1 comment",
    commentCountMany: "{count} comments",
    mediaNouns: {
      feed: "post",
      reels: "reel",
      story: "story",
      ad: "ad",
    },
  },

  settings: {
    eyebrow: "settings",
    title: "Settings",
    subtitle: "Manage your account and the API keys for external integration.",
    tabs: {
      cuenta: "Account",
      "api-keys": "API keys",
      suscripcion: "Subscription",
    },
    tabsAria: "Settings sections",
    language: {
      title: "Language",
      body: "The language of the console. It doesn't change the API's language or the language of Meta's emails.",
      label: "Console language",
      es: "Español",
      en: "English",
    },
  },

  account: {
    title: "Account",
    emailLabel: "email",
    tenantIdLabel: "tenant_id",
    copyTenantId: "Copy the account identifier",
    passwordTitle: "Change password",
    passwordBody:
      "Set a new password. When you save it we sign you out and you'll have to sign in again.",
    newPassword: "New password",
    newPasswordPlaceholder: "At least 8 characters",
    confirmPassword: "Repeat password",
    confirmPasswordPlaceholder: "Repeat the new password",
    passwordHint: "At least 8 characters.",
    passwordSubmit: "Change password",
    deleteTitle: "Delete account",
    deleteBody:
      "Permanently deletes your account and all your data: connected pages, conversations, messages and API keys. Before deleting we try to unsubscribe your pages from Meta's webhook. It's immediate and can't be undone; backups are purged within 30 days.",
    deleteCta: "Delete account",
    deleteDialogTitle: "Delete your account",
    deleteDialogBody:
      "Your account, your connected pages, your conversations, your messages and your API keys are deleted. It's immediate and can't be undone.",
    deleteConfirmBefore: "Type ",
    deleteConfirmAfter: " to confirm",
    deleteConfirm: "Yes, delete my account",
    deleting: "Deleting…",
    signInMethods: {
      title: "How you sign in to Resender",
      body: "Each way in is independent: linking Google doesn't remove your password.",
      emailUnverified: "Email not confirmed",
      emailUnverifiedHint: "Confirm it to be able to link Google.",
      resend: "Resend confirmation",
      resendSent: "Done, we sent it again.",
      password: "Password",
      passwordConfigured: "Set",
      passwordMissing: "Not set",
      google: "Google",
      googleNotLinked: "Not linked",
      link: "Link",
      linkRequiresVerified: "Confirm your email first",
      unlink: "Unlink",
      unlinkHint: "Unlinking requires a recent session.",
      lastCredentialHint: "It's your only way in; it can't be removed.",
      linked: "Linked",
    },
  },

  apiKeys: {
    createTitle: "Create API key",
    createBody:
      "Use opaque API keys so n8n or your backend can call Resender's external API. The full secret is shown only once.",
    labelPlaceholder: "n8n production",
    labelAria: "API key label",
    create: "Create key",
    creating: "Creating…",
    revealTitle: "Copy the key now: we won't show it again.",
    copyKey: "Copy the API key",
    listTitle: "API keys",
    listBody: "Revoking is immediate: calls using that key start failing.",
    empty: "You haven't created any API key yet.",
    headLabel: "LABEL",
    headPrefix: "PREFIX",
    headStatus: "STATUS",
    headCreated: "CREATED",
    headActions: "Actions",
    statusActive: "active",
    statusRevoked: "revoked",
    revoke: "Revoke",
    revoking: "Revoking…",
    revokeTitle: "Revoke «{label}»",
    revokeBody:
      "The effect is immediate: calls using this key start failing. The key stays visible in the list as revoked, and can't be reactivated.",
    revokeConfirm: "Yes, revoke",
  },

  subscription: {
    title: "Subscription",
    none: "no subscription",
    noneBody: "There's no subscription on record for this account.",
    choosePlan: "Choose a plan",
    planLabel: "plan",
    renewsLabel: "renews",
    cancelsLabel: "cancels",
    connectionsLabel: "connections",
    perMonth: " · ${price} / month",
    periodMessages: "Messages this period",
    usageAria: "Message usage for the period",
    limitsUnresolved:
      "We couldn't resolve your plan's limits, so we can't show you your usage. Write to",
    managePortal: "Manage subscription",
    portalHint:
      "Change plan, update your payment method or cancel in Stripe's customer portal.",
  },

  accessPending: {
    eyebrow: "access",
    title: "You're in.",
    body: "Your account is created and your spot on the list is saved. We're opening access gradually, account by account: we'll email you as soon as it's your turn, and there's nothing else for you to do.",
    emailLabel: "We'll write to",
    helpBefore: "In the meantime you can read the ",
    helpDocsLink: "documentation",
    helpMiddle: " or write to us at ",
    helpAfter: ".",
    signOut: "Sign out",
    verify: {
      title: "Confirm your email",
      body: "We emailed {email} to confirm it's yours. You don't need it to wait for approval, but you do need it to sign in with Google.",
      resend: "Resend confirmation",
      sent: "Done, we sent it again.",
      linkExpired: "The link expired. Request a new one.",
    },
  },

  billing: {
    metaTitle: "Subscription",
    eyebrow: "pricing",
    title: "Choose your plan.",
    subtitle:
      "Your account is approved. Payment happens on a secure Stripe page.",
    signOut: "Sign out",
    perMonth: "/ month",
    planLimitsOne: "{messages} messages · {pages} connection",
    planLimitsMany: "{messages} messages · {pages} connections",
    subscribe: "Subscribe",
    footnote:
      "Change plan, update your card or cancel whenever you want from Settings, with Stripe's portal.",
    successMetaTitle: "Activating your subscription",
    successTitle: "Activating your subscription…",
    successBody:
      "Thanks for subscribing. We're confirming the payment with Stripe: it usually takes a few seconds and this page takes you in on its own. You don't need to reload or pay again.",
    successSlowBefore: "Taking longer than expected? ",
    successSlowLink: "Open the app",
    successSlowMiddle: " or write to ",
    successSlowAfter: ".",
  },

  metaErrors: {
    prefix: "Couldn't connect",
    unknown: "Couldn't connect: {reason}.",
    empty: "Couldn't connect.",
    webhookSubscriptionFailed:
      "Couldn't connect: Meta didn't confirm the webhook subscription for every page. No page was saved.",
    pageOwned:
      "Couldn't connect: page {id} already belongs to another Resender account.",
    configurationFailed:
      "Couldn't connect: the server's secret encryption isn't configured.",
    metaSessionExpired:
      "Couldn't connect: your Meta authorization expired. Connect Facebook again.",
    stateMismatch:
      "Couldn't connect: the authorization session expired or doesn't match. Please try again.",
    instagramNotEnabled:
      "Couldn't connect: the Instagram channel isn't enabled for your account.",
    instagramPageLimitReached:
      "Couldn't connect: your plan's connection quota is full. Disconnect a connection in Connections to free up a slot.",
    instagramExchangeFailed:
      "Couldn't connect: Instagram didn't complete the credential exchange. Please try again.",
    instagramProfileFailed:
      "Couldn't connect: Instagram authorized the account but didn't return its profile. Check that it's a professional account and try again.",
    instagramSubscriptionFailed:
      "Couldn't connect: Instagram didn't confirm the webhook subscription. The account wasn't connected.",
    instagramAccountOwned:
      "Couldn't connect: the Instagram account {id} already belongs to another Resender account.",
    whatsappNotEnabled:
      "Couldn't connect: the WhatsApp channel isn't enabled for your account.",
    whatsappPageLimitReached:
      "Couldn't connect: your plan's connection quota is full. Disconnect a connection in Connections to free up a slot.",
    whatsappExchangeFailed:
      "Couldn't connect: Meta didn't complete the WhatsApp credential exchange. Please try again.",
    whatsappAssetsFailed:
      "Couldn't connect: the authorization didn't include the number or the WhatsApp Business account. Run it again and pick the number you want to connect.",
    whatsappRegisterFailed:
      "Couldn't connect: Meta couldn't register the number on the Cloud API. Check that it isn't in use on another platform and try again.",
    whatsappSubscribeFailed:
      "Couldn't connect: Meta didn't confirm the webhook subscription for the WhatsApp Business account. The number wasn't connected.",
    whatsappSyncRequestFailed:
      "Couldn't connect: the number was connected but we couldn't request its history from Meta. The 24-hour window is already running: run the Coexistence signup again to request it once more.",
    whatsappStateMismatch:
      "Couldn't connect: the authorization doesn't match this tab. This usually happens when Connections was left open in another tab or window, because the second one invalidates the connection the first one started. Close the others and run it again from a single one.",
    whatsappPinRequired:
      "Couldn't connect: the number already has two-step verification turned on. Run the connection again providing its six-digit PIN, or turn it off from WhatsApp Manager and try again.",
    whatsappPersistFailed:
      "Couldn't connect: the number was authorized on Meta but couldn't be saved. Please try again; if it keeps happening, write to us.",
    whatsappNumberOwned:
      "Couldn't connect: the WhatsApp number {id} already belongs to another Resender account.",
  },

  actions: {
    notSignedIn: "You're not signed in.",
    waitlisted: "Your account is on the waitlist.",
    noSubscription: "Your subscription isn't active.",
    invalidPage: "Invalid page.",
    pageNotFound: "We couldn't find that page.",
    invalidApiKey: "That API key isn't valid.",
    apiKeyNotFound: "We couldn't find that API key.",
    apiKeyLabelRequired: "Enter a label for the key.",
    apiKeyLabelTooLong: "The label can't be longer than 80 characters.",
    apiKeyRevealed: "Copy the key now: we won't show it again.",
    accountNotFound: "We couldn't find the account.",
    confirmEmailMismatch:
      "The email doesn't match. Type your exact email to confirm.",
    deletePrepareFailed:
      "We couldn't prepare the deletion. Please try again in a minute.",
    invalidEmail: "Enter a valid email.",
    passwordTooShort: "The password must be at least 8 characters.",
    passwordsDoNotMatch: "The passwords don't match.",
    selectOnePage: "Pick at least one page.",
    selectOneNewPage: "Pick at least one new page to connect.",
    planUnresolved:
      "We couldn't resolve your plan's limits. Write to info@resender.dev.",
    quotaCheckFailed:
      "We couldn't check your plan's quota right now. Please try again in a moment.",
    connectFailed:
      "Couldn't connect: something went wrong with the selected pages. Please try again.",
    disconnected: "Page disconnected. The history is kept.",
    secretRotated: "Secret rotated. Copy it now: it won't be shown again.",
    webhookUpdated: "Webhook updated.",
    webhookUpdatedWithSecret: "Webhook updated. Copy the signing secret:",
    webhookUrlNotHttps:
      "The URL has to use https. http is only allowed on localhost, for development.",
    webhookUrlInvalid: "Enter a valid URL.",
    whatsappNotEnabled: "The WhatsApp channel isn't enabled for your account.",
    whatsappNoPin:
      "This number doesn't have a PIN generated by Resender. If you chose it yourself, check it in WhatsApp Manager.",
    accountSlotFull:
      "Your plan allows {maxPages} connections and you already have {activePageCount} active. Disconnect one in Connections to free up a slot and run the connection again.",
    invalidSelection:
      "That selection includes a page you can't connect. Reload the screen and try again.",
    pageLimitPlan:
      "Your plan allows {maxPages} connections and you already have {activePageCount} active",
    pageLimitNone:
      ": you're out of quota. Disconnect a page to free up a slot and connect another one.",
    pageLimitRemainingOne:
      ": you can add {remainingSlots} more page. Uncheck the extra ones, or disconnect a page to free up a slot.",
    pageLimitRemainingMany:
      ": you can add {remainingSlots} more pages. Uncheck the extra ones, or disconnect a page to free up a slot.",
    googleNotConfigured: "Signing in with Google isn't available right now.",
    unlinkLastCredential: "You can't remove your only way in.",
    sessionNotFresh: "To unlink, sign out and sign in again.",
    linkFailed: "We couldn't link Google. Try again.",
    oauthAccountNotLinked:
      "It wasn't linked: confirm your email first and try again.",
  },

  whatsappEvents: {
    finishedWithoutNumber:
      "You finished without adding a number: the WhatsApp Business account is ready, but Resender needs a number to receive messages. Run the connection again and complete the phone step.",
    flowError:
      "Meta cut the connection with an error and no number was connected. Try again in a few minutes; if it keeps happening, write to info@resender.dev.",
    malformed:
      "Meta returned an incomplete response and no number was connected. Run the connection again.",
    reportedError: "Meta rejected the connection: {message}{suffix}",
    reportedErrorCode: "code {code}",
    reportedErrorSession: "session {id}",
    reportedErrorSuffix: " ({reference} — quote them if you contact support).",
    abandoned:
      "You closed Meta's window before finishing, so no number was connected.{where} You can run it again whenever you want.",
    abandonedWhere: " You stopped at {step}.",
    unsupportedMigration:
      "You completed a migration from another provider. That flow isn't supported in Resender yet: write to info@resender.dev and we'll do it with you.",
    unsupportedGrantOnly:
      "You only granted API access, without connecting a number. Run the connection again and complete the flow up to picking the phone.",
    unsupportedOther:
      "Meta finished the flow in a variant that Resender doesn't support yet ({event}). No number was connected; write to info@resender.dev.",
    steps: {
      BUSINESS_ACCOUNT_SELECTION: "the business portfolio selection",
      WABA_PHONE_PROFILE_PICKER: "the WhatsApp Business account selection",
      WHATSAPP_BUSINESS_PROFILE_SETUP: "creating the WhatsApp Business account",
      PHONE_NUMBER_SETUP: "the phone number setup",
      PHONE_NUMBER_VERIFICATION: "the number verification",
      PERMISSIONS: "the permissions review",
    },
  },

  whatsappSignup: {
    connect: "Connect WhatsApp",
    connecting: "Connecting…",
    description:
      "Meta opens its window and you choose there: register a new number, or connect the one you already use in the WhatsApp Business app. The choice matters —each option leaves the number in a different state— and we'll tell you what it means as soon as the window closes.",
    preparing: "Preparing the connection with Meta…",
    nonceFailed:
      "We couldn't prepare the WhatsApp connection. Reload the page and try again.",
    submitFailed:
      "Couldn't connect. Please try again; if it keeps happening, write to info@resender.dev.",
    networkFailed:
      "We couldn't reach the server to finish the connection. Check your network and run it again.",
    pairingIncomplete:
      "Meta's authorization came back incomplete and no number was connected. Run it again; if it keeps happening, write to info@resender.dev.",
    sdkBlocked:
      "We couldn't load the Facebook SDK, which is what opens Meta's window. It's usually an ad or tracker blocker: allow it for this site and reload the page.",
    popupClosed:
      "Meta's window closed without completing the authorization, so no number was connected. If you never saw it, allow pop-ups for this site and try again.",
    notConfigured:
      "Connecting WhatsApp isn't available on this deployment: NEXT_PUBLIC_WHATSAPP_CONFIG_ID is missing. Write to info@resender.dev.",
    pinLabel: "Two-step verification PIN",
    pinPlaceholder: "6 digits",
    pinHint: "Type the number's current PIN and run the connection again.",
  },
}

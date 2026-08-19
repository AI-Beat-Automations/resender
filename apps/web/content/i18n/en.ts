// English copy for the public site (served under /en). Twin of `es.ts`: both
// implement `Dict`, so a missing key on either side breaks the typecheck.

import type { Dict } from "./dictionary"

export const en: Dict = {
  nav: {
    pricing: "Pricing",
    blog: "Blog",
    docs: "Docs",
    login: "Log in",
    getStarted: "Get started",
    menu: "Menu",
    openMenu: "Open menu",
    home: "Resender.dev — home",
  },

  hero: {
    eyebrow: "receive and reply to Facebook messages via API",
    title: "The relay API for Facebook messages.",
    titleAccent: "Developer-first.",
    subtitle:
      "Connect your Page, point your webhook and reply with a POST. No visual builders, no features you'll never use.",
    ctaPrimary: "Get started",
    ctaSecondary: "See how it works",
  },

  flowMock: {
    live: "message-flow · live",
    in: {
      meta: "Facebook · 2:02 PM",
      text: "Hi, do you have a slot for today?",
    },
    hook: {
      meta: "your server",
      text: "Your automation receives the message and generates the reply",
    },
    out: { meta: "POST · 2:02 PM", text: "Yes! See you today at 3:00 PM 👍" },
  },

  pain: {
    kicker: "the problem",
    title: "The same old pain",
    subtitle:
      "If you've ever tried to process Facebook messages, you know exactly what we mean.",
    questions: [
      "How do I connect my n8n to Facebook?",
      "Connecting any automation to Facebook is a headache",
      "I just need the API — does anyone know something cheaper?",
      "I want one place to manage the agents for all my clients",
      "I need something simple and fast to connect to a client's Page",
    ],
    items: [
      {
        icon: "wallet",
        title: "You pay for features you never open",
        body: "Expensive plans come with builders, templates and engagement analytics. You just want to receive and reply to messages.",
      },
      {
        icon: "unplug",
        title: "Connecting to Facebook is a maze",
        body: "Reviewers, expiring tokens, permissions and webhooks. Maybe you already tried the direct route and gave up halfway.",
      },
      {
        icon: "users",
        title: "Juggling multiple clients",
        body: "You're an agency, and every client is another Page, another automation and another account to keep in order.",
      },
      {
        icon: "zap",
        title: "You need something simple and fast",
        body: "Connecting to a client's Page should take minutes, not a whole afternoon of setup.",
      },
    ],
  },

  howItWorks: {
    kicker: "flow",
    title: "From zero to receiving messages in minutes",
    subtitle: "",
    stepLabel: "Step",
    steps: [
      {
        title: "Connect your Page",
        body: "Link your Facebook Page in a couple of clicks.",
      },
      {
        title: "Set up your webhook",
        body: "Paste your webhook URL and Resender starts forwarding incoming messages to you.",
      },
      {
        title: "Receive the messages",
        body: "Every message arrives at your endpoint as JSON, ready for your automation.",
      },
      {
        title: "Reply via API",
        body: "Make a POST back to Resender and we deliver the reply to the end user.",
      },
    ],
  },

  quickstart: {
    kicker: "quickstart",
    title: "One request and you're already replying",
    subtitle: "A POST from your backend, from n8n, from wherever.",
    filename: "reply.request",
    replySample: "Yes! See you today at 3:00 PM 👍",
    copy: "Copy code",
    copied: "Copied",
  },

  pricingPreview: {
    kicker: "pricing",
    title: "Simple, transparent plans",
    subtitle: "Pick the one that fits your volume. Change whenever you want.",
    cta: "See full plans",
  },

  faq: {
    kicker: "faq",
    title: "Frequently asked questions",
    items: [
      {
        q: "Which channels does Resender work with?",
        a: "Today Resender works with Facebook Pages (Messenger). You connect your Page and start receiving messages at your webhook.",
      },
      {
        q: "Do I need Facebook approval to use Resender?",
        a: "Resender handles the integration with Facebook's APIs for you. Depending on your use case, Facebook review may be required, but we guide you through the process.",
      },
      {
        q: "How does the webhook work?",
        a: "You set an HTTPS URL per Page. When a message comes in, Resender persists it and forwards it to your endpoint as JSON. You reply with a POST to our outbound API.",
      },
      {
        q: "Can I use Resender with n8n, Make or Zapier?",
        a: "Yes. Resender is API-only, so it plugs into any no-code/low-code tool or your own code.",
      },
      {
        q: "What happens if I go over my plan's messages?",
        a: "We let you know when you're getting close to the limit, and you can upgrade anytime without losing your setup.",
      },
      {
        q: "Can I change plans at any time?",
        a: "Yes, you can upgrade or downgrade whenever you want. Changes take effect on your next billing cycle.",
      },
      {
        q: "What payment methods do you accept?",
        a: "We accept major credit and debit cards through Stripe.",
      },
    ],
  },

  finalCta: {
    title: "Ready to get started?",
    subtitle:
      "Connect your first Page and receive messages in minutes. No card to get going.",
    cta: "Get started",
  },

  pricing: {
    kicker: "pricing",
    title: "Pricing",
    subtitle:
      "A plan for every stage. No contracts, no surprises. Cancel whenever you want.",
    intro: [
      "Both plans include the same thing: the full API, inbound and outbound webhooks, and support. The only difference is how many messages you process per month and how many Facebook Pages you connect.",
      "A message is every event that crosses the relay, in either direction: the one a user sends you and that lands at your webhook counts as one, and your reply through the API counts as another. A ten-turn back-and-forth uses twenty messages. Webhook retries after an outage are not billed.",
      "If you are torn between the two, start with Starter. 50,000 messages a month is roughly 25,000 short conversations, plenty for a side project or your first clients. We warn you as you approach the limit, and moving up to Pro is immediate: no downtime and nothing to reconnect.",
      "We charge per message processed rather than per contact reached, which is the difference that shows most against ManyChat as you grow: your bill tracks real traffic, not the accumulated size of your audience.",
    ],
    plans: [
      {
        name: "Starter",
        price: "$15",
        period: "/mo",
        description: "To get your first project off the ground.",
        featured: false,
        badge: null,
        cta: "Get started with Starter",
        features: [
          "50,000 messages per month",
          "2 Facebook Pages",
          "Email + Discord support",
        ],
      },
      {
        name: "Pro",
        price: "$25",
        period: "/mo",
        description: "For growing devs and agencies.",
        featured: true,
        badge: "Recommended",
        cta: "Get started with Pro",
        features: [
          "100,000 messages per month",
          "5 Facebook Pages",
          "Email + Discord support",
        ],
      },
    ],
  },

  comparison: {
    kicker: "vs manychat",
    title: "Resender vs ManyChat",
    subtitle:
      "If all you need is the Facebook API, you're overpaying. See the difference.",
    yes: "Yes",
    no: "No",
    headers: { feature: "", resender: "Resender", manychat: "ManyChat" },
    rows: [
      { feature: "Entry price", resender: "$15/mo", manychat: "$39+/mo" },
      { feature: "Clean API and webhooks", resender: true, manychat: true },
      { feature: "No extra visual builders", resender: true, manychat: false },
      { feature: "Developer-first focus", resender: true, manychat: false },
      { feature: "Setup in minutes", resender: true, manychat: false },
      {
        feature: "Integrates with n8n / Make / Zapier",
        resender: true,
        manychat: true,
      },
      {
        feature: "Visual templates and engagement analytics",
        resender: "You don't need them",
        manychat: true,
      },
    ],
  },

  vsManychat: {
    kicker: "comparison",
    title: "Resender vs ManyChat",
    subtitle:
      "Both connect to Facebook Messenger. One is a full no-code platform; the other is the relay API you need when you already have somewhere to run your logic.",
    intro: [
      "ManyChat is a conversational marketing platform: a visual flow builder, broadcast sequences, templates and engagement analytics. If your team builds campaigns without writing code, that toolbox makes sense and you'll use all of it.",
      "Resender doesn't compete with that. It does one thing: it pushes every message your Facebook Page receives to your webhook, and lets you reply with a POST. The logic lives wherever you want it — n8n, Make, an AI agent or your own backend.",
      "The practical difference shows up in the bill and in the ceiling. ManyChat starts at $39/mo for a platform whose builder you won't open if your flow already runs elsewhere. Resender charges $15/mo for the transport, and your logic is limited only by your own code.",
    ],
    verdict: {
      title: "Which one fits you",
      items: [
        {
          when: "Your team builds the flows without programming",
          pick: "ManyChat. The visual builder and templates exist for exactly that, and rebuilding them in code will cost you more than you save.",
        },
        {
          when: "Your logic already lives in n8n, Make, Zapier or your backend",
          pick: "Resender. All you're missing is the transport to Facebook, and that's the only thing you'll pay for.",
        },
        {
          when: "You're wiring an AI agent to Facebook",
          pick: "Resender. The agent needs the raw message at its webhook and a direct way to reply, not a builder in between.",
        },
        {
          when: "You manage Pages for several clients",
          pick: "Resender. Connect multiple Pages under one account and route them by webhook, without one subscription per client.",
        },
        {
          when: "You need broadcasts, sequences and engagement analytics",
          pick: "ManyChat. Resender doesn't have them and won't: it's infrastructure, not a marketing tool.",
        },
      ],
    },
    faq: {
      title: "Frequently asked questions",
      items: [
        {
          q: "Does Resender replace ManyChat?",
          a: "Only if you were using ManyChat for its API. If you depend on the visual builder, broadcasts or engagement analytics, Resender doesn't cover that. If your flow already runs in n8n, Make or your backend, then yes: same result without the platform in between.",
        },
        {
          q: "How much cheaper is Resender than ManyChat?",
          a: "Resender starts at $15/mo with 50,000 messages and 2 Pages. ManyChat's Pro plan starts at $39/mo and scales with your contact count. The gap widens as you grow, because Resender charges per message rather than per contact.",
        },
        {
          q: "Can I use Resender with n8n the way I used ManyChat?",
          a: "Yes, and it's the main use case. Point Resender's webhook at your n8n workflow, receive the message there and reply with an HTTP Request node against Resender's API.",
        },
        {
          q: "Do I need Facebook approval to migrate?",
          a: "Resender already has the Messenger permissions approved, so you connect your Page with Facebook Login and you're done. No app review of your own.",
        },
        {
          q: "Can I use both at once?",
          a: "A Facebook Page sends its webhooks to one app at a time, so it's best to pick one per Page. What you can do is keep some Pages on ManyChat and others on Resender.",
        },
      ],
    },
    cta: {
      title: "Try the direct relay",
      subtitle:
        "Connect your Page, point your webhook and reply with a POST. No contracts.",
      cta: "Get started",
    },
    metaTitle: "Resender vs ManyChat: the API-first alternative",
    metaDescription:
      "An honest comparison of Resender and ManyChat: $15 vs $39/mo, API and webhooks, and which one fits depending on whether you use a visual builder or n8n, Make and AI agents.",
  },

  pricingFaq: {
    kicker: "faq",
    title: "Pricing questions",
    items: [
      {
        q: "What happens if I go over my messages?",
        a: "We let you know when you're getting close to the limit. You can upgrade with no interruptions.",
      },
      {
        q: "Can I change plans?",
        a: "Yes, upgrade or downgrade whenever you want. Changes are prorated on your next cycle.",
      },
      {
        q: "Is there a contract or commitment?",
        a: "No. It's month to month and you cancel whenever you want, no penalties.",
      },
      {
        q: "What payment methods do you accept?",
        a: "Credit and debit cards through Stripe.",
      },
      {
        q: "Do retries count as messages?",
        a: "No. If your webhook goes down and we retry delivery, the message is billed once. We count unique events, not network attempts.",
      },
      {
        q: "Can I connect more Pages than my plan includes?",
        a: "The Page limit is per plan: 2 on Starter and 5 on Pro. If you need more, move up to Pro or write to us and we'll put something together for your volume.",
      },
      {
        q: "What happens to my data if I cancel?",
        a: "Your connections go inactive and we stop receiving messages from your Pages. You can request deletion of your data at any time from the data deletion page.",
      },
    ],
  },

  pricingCta: {
    title: "Start building today",
    subtitle: "Create your account and connect your first Page in minutes.",
    cta: "Get started",
  },

  blog: {
    metaTitle: "Blog: integrating Facebook Messenger via API",
    metaDescription:
      "Tutorials on webhooks, AI agents and automations with n8n, Make and Zapier on top of Facebook messages, plus Resender product news.",
    title: "Blog",
    intro:
      "We write about what we run into while building Resender: how to set boundaries for an AI agent handling customers, how to pick an AI model for your agent, and how many AI agents your automation should have. Concrete cases, with the code we actually use.",
    empty: "No posts published yet.",
    back: "← Back to blog",
    reading: {
      title: "Ready to get started?",
      subtitle: "Connect your first Page and receive messages in minutes.",
      cta: "Get started",
    },
    categories: { tutorial: "Tutorial", actualizacion: "News" },
    filters: { tutorial: "Tutorials", actualizacion: "News" },
    filterGroupLabel: "Filter posts",
    emptyCategory: "No posts in this category.",
    tocNavLabel: "Table of contents",
    tocTitle: "In this article",
    rssTitle: "Resender Blog",
    rssDescription: "Tutorials and news from Resender.",
  },

  auth: {
    login: {
      eyebrow: "access",
      title: "Log in",
      subtitle: "Sign in to manage your connections and message log.",
    },
    register: {
      eyebrow: "sign-up",
      title: "Create account",
      subtitle: "Email and password. No email verification in the MVP.",
    },
    passwordChanged: "Password updated. Sign in with the new one.",
    form: {
      email: "Email",
      password: "Password",
      emailPlaceholder: "you@company.com",
      passwordPlaceholder: "At least 8 characters",
      passwordHint: "At least 8 characters.",
      processing: "Processing…",
      signIn: "Sign in",
      createAccount: "Create account",
      noAccount: "Don't have an account?",
      haveAccount: "Already have an account?",
      signUp: "Create one",
      signInAction: "Sign in",
    },
    errors: {
      invalidCredentials: "Incorrect email or password.",
      duplicateEmail: "That email is already registered. Sign in.",
      invalidInput: "Check your email and password and try again.",
      createdNoSignin:
        "We created your account, but couldn't sign you in. Sign in from Log in.",
    },
  },

  // Public waitlist (ADR 0007). The promise is always "product updates", never
  // a specific channel: the announcement goes out once to the whole list, so
  // "we'll tell you when X ships" would be a promise the system can't keep
  // per person. The consent line says exactly what `es.ts` says — it is the
  // text versioned as `consent_version = "2026-08"`.
  waitlist: {
    page: {
      kicker: "waitlist",
      title: "One webhook for every channel.",
      titleAccent: "Developer-first.",
      subtitle:
        "Today Resender works with Facebook Messenger only, but we're already working on the Instagram and WhatsApp integrations. Leave your email and we'll tell you when they're available.",
      breadcrumb: "Waitlist",
      registerTitle: "Already on Messenger?",
      registerBody:
        "Then there's nothing to wait for. Create your account, connect your Page and get your first message at your webhook today.",
      registerCta: "Create account",
    },
    form: {
      title: "Leave us your email",
      subtitle:
        "We write to you when there are product updates. Nothing else: no weekly newsletter, no sales follow-up.",
      emailLabel: "Email",
      emailPlaceholder: "you@company.com",
      heardFromLabel: "How did you hear about Resender?",
      heardFromPlaceholder: "Pick one",
      heardFromOtherLabel: "Where did you see us?",
      heardFromOtherPlaceholder: "Tell us in a few words",
      consent:
        "I agree that Resender stores my email address to send me product updates. I can ask to be removed at any time by writing to info@resender.dev.",
      submit: "Join the list",
      processing: "Sending…",
      success:
        "Done. Your email is on the list and we'll write to you when there's news.",
      heardFromOptions: {
        tiktok: "TikTok",
        instagram: "Instagram",
        x: "X",
        youtube: "YouTube",
        linkedin: "LinkedIn",
        event: "An event or conference",
        other: "Other",
      },
    },
    errors: {
      email: "Check your email address and try again.",
      heardFrom: "Pick how you heard about Resender.",
      heardFromOther: "Tell us where you saw us.",
      heardFromOtherTooLong: "Use 120 characters at most.",
      consent: "Tick the box so we can write to you.",
      rateLimited: "Too many attempts. Wait a moment and try again.",
      unexpected: "We couldn't save your email. Try again in a few minutes.",
    },
  },

  footer: {
    tagline: "The relay API for Facebook messages. Simple and developer-first.",
    columns: { product: "Product", legal: "Legal", contact: "Contact" },
    links: {
      pricing: "Pricing",
      vsManychat: "vs ManyChat",
      blog: "Blog",
      docs: "Docs",
      privacy: "Privacy",
      terms: "Terms",
      dataDeletion: "Data deletion",
    },
  },

  meta: {
    home: {
      title: "Resender — The relay API for Facebook messages",
      description:
        "The developer-first alternative to ManyChat. Receive Facebook messages at your webhook and reply via API. Simple, with no features you'll never use.",
      ogTitle: "Resender — The relay API for Facebook messages",
      ogDescription:
        "Receive Facebook messages at your webhook and reply via API. Simple and developer-first.",
    },
    pricing: {
      title: "Pricing and plans from $15 per month",
      description:
        "Resender plans from $15/mo with 50,000 messages and 2 Facebook Pages. No contracts, no per-contact charges, and you can cancel whenever you want.",
      ogTitle: "Pricing and plans from $15 per month",
      ogDescription:
        "Simple plans from $15/mo. The developer-first alternative to ManyChat.",
    },
    // The page is indexable (it left PRIVATE_PATHS in robots.ts, ADR 0007), so
    // the description has to work as a search snippet.
    waitlist: {
      title: "Waitlist: get the product updates",
      description:
        "Resender works with Facebook Messenger only for now. Leave your email on the waitlist and we'll tell you when there are product updates.",
      ogTitle: "Waitlist: get the product updates",
      ogDescription:
        "Today Resender works with Facebook Messenger only. Leave your email and we'll tell you when the product changes.",
    },
  },

  llms: {
    summary:
      "The relay API for Facebook messages. Connect your Page, point your webhook and reply with a POST — no visual builders, no features you'll never use. A developer-first alternative to ManyChat, from $15/mo. Operated by Lorna Suriano Hernandez.",
    context: [
      "Resender solves one specific problem: receiving the messages sent to a Facebook Page (Messenger) on your own server, and replying to them via API. The logic runs wherever you want it — n8n, Make, Zapier, an AI agent or your own backend — and Resender only handles the transport to and from Facebook.",
      "How it works: you connect your Page with Facebook Login, set an HTTPS URL per Page, every incoming message arrives at that endpoint as JSON, and you reply with a POST to Resender's outbound API. The Messenger permissions are already approved, so you don't go through an app review of your own.",
      "What it is NOT: Resender has no visual flow builder, broadcasts, templates or engagement analytics. If you need those, ManyChat is the better choice and we say so in the comparison.",
      "Pricing: Starter $15/mo (50,000 messages, 2 Facebook Pages) and Pro $25/mo (100,000 messages, 5 Pages). Billing is per message processed in either direction, not per contact reached. Retries after a webhook outage are not billed. No contracts: it's month to month.",
      "The site is in Spanish at the root and in English under /en. The legal pages exist in Spanish only.",
    ],
    sections: {
      product: "Product",
      docs: "Documentation",
      blog: "Blog",
      legal: "Legal",
      optional: "Optional",
    },
    entries: {
      home: {
        label: "Home",
        detail:
          "What Resender is, the four-step flow, the quickstart with the reply request, and frequently asked questions.",
      },
      pricing: {
        label: "Pricing",
        detail:
          "The Starter and Pro plans, what counts as a message, how billing works and billing questions.",
      },
      vsManychat: {
        label: "Resender vs ManyChat",
        detail:
          "Price and scope compared against ManyChat, and which one fits which case.",
      },
      blog: {
        label: "Blog",
        detail:
          "Tutorials on webhooks, AI agents and automations with n8n, Make and Zapier, plus product news.",
      },
      docs: {
        label: "Technical documentation",
        detail:
          "API reference: authentication, inbound webhook format and the reply endpoint. Lives on its own subdomain.",
      },
      privacy: {
        label: "Privacy policy",
        detail: "What data Resender stores and for how long. Spanish only.",
      },
      terms: {
        label: "Terms of service",
        detail:
          "Terms for using Resender, operated by Lorna Suriano Hernandez. Spanish only.",
      },
      dataDeletion: {
        label: "Data deletion",
        detail: "How to request deletion of your data. Spanish only.",
      },
      full: {
        label: "Full site content",
        detail:
          "The complete text of every page and blog post in a single markdown file.",
      },
      otherLocale: {
        label: "Versión en español",
        detail:
          "The same index, with the URLs of the Spanish version of the site.",
      },
      rss: {
        label: "Blog RSS",
        detail: "Feed of the English-language posts.",
      },
    },
    fullFile: {
      title: "Resender — full content",
      note: "A dump of the complete text of the site and the blog. The shorter, curated index lives at {index}. Last updated: {date}.",
      postsTitle: "Blog posts",
      sourceLabel: "Source",
      publishedLabel: "Published",
      plansTitle: "Plans",
      comparisonTitle: "Comparison table",
    },
  },
}

// Copy centralizado del sitio público, en español (idioma por defecto, en la
// raíz). El gemelo en inglés vive en `en.ts` y ambos implementan `Dict`, así que
// cualquier clave que falte rompe el typecheck. Los componentes reciben `lang` y
// resuelven el copy con `getDictionary(lang)`.

import type { Dict } from "./dictionary"

export const es: Dict = {
  nav: {
    pricing: "Precios",
    blog: "Blog",
    docs: "Docs",
    login: "Iniciar sesión",
    getStarted: "Empezá",
    menu: "Menú",
    openMenu: "Abrir menú",
    home: "Resender.dev — inicio",
  },

  hero: {
    eyebrow: "recibe y responde mensajes de Facebook por API",
    title: "La API relay para mensajes de Facebook.",
    titleAccent: "Developer-first.",
    subtitle:
      "Conecta tu página, apunta tu webhook y responde con un POST. Sin builders visuales ni features que no usás.",
    ctaPrimary: "Empezá",
    ctaSecondary: "Ver cómo funciona",
  },

  flowMock: {
    live: "message-flow · en vivo",
    in: { meta: "Facebook · 14:02", text: "Hola, ¿tienen turno para hoy?" },
    hook: {
      meta: "tu servidor",
      text: "Tu automatización recibe el mensaje y genera la respuesta",
    },
    out: { meta: "POST · 14:02", text: "¡Sí! Te espero hoy a las 15:00 👍" },
  },

  // Sección "El dolor de siempre": un marquee de preguntas/quejas reales que se
  // mueven, y debajo las cards horizontales de pain points. `icon` mapea a un
  // registro en el componente PainPoint.
  pain: {
    kicker: "el problema",
    title: "El dolor de siempre",
    subtitle:
      "Si ya intentaste procesar mensajes de Facebook, sabés de qué hablamos.",
    questions: [
      "¿Cómo conecto mi n8n a Facebook?",
      "Conectar cualquier automatización a Facebook es un dolor de cabeza",
      "Solamente necesito la API, ¿alguien conoce algo más barato?",
      "Quiero algo donde pueda manejar los agentes de todos mis clientes",
      "Necesito algo sencillo y rápido para conectarme a la página del cliente",
    ],
    items: [
      {
        icon: "wallet",
        title: "Pagás por funciones que ni abrís",
        body: "Los planes caros vienen con builders, templates y analytics de engagement. Vos solo querés recibir y responder mensajes.",
      },
      {
        icon: "unplug",
        title: "Conectar con Facebook es un laberinto",
        body: "Reviewers, tokens que expiran, permisos y webhooks. Capaz ya lo intentaste directo y quedaste en el camino.",
      },
      {
        icon: "users",
        title: "Malabares con varios clientes",
        body: "Sos agencia y cada cliente es otra página, otra automatización y otra cuenta que mantener en orden.",
      },
      {
        icon: "zap",
        title: "Necesitás algo simple y rápido",
        body: "Conectarte a la página de un cliente debería tomar minutos, no una tarde entera de configuración.",
      },
    ],
  },

  howItWorks: {
    kicker: "flujo",
    title: "De cero a recibiendo mensajes en minutos",
    subtitle: "",
    stepLabel: "Paso",
    steps: [
      {
        title: "Conecta tu página",
        body: "Vinculá tu página de Facebook con un par de clics.",
      },
      {
        title: "Configurá tu webhook",
        body: "Pegá la URL de tu webhook y Resender empieza a reenviarte los mensajes entrantes.",
      },
      {
        title: "Recibe los mensajes",
        body: "Cada mensaje llega a tu endpoint como JSON, listo para tu automatización.",
      },
      {
        title: "Responde por API",
        body: "Hacé un POST de vuelta a Resender y entregamos la respuesta al usuario final.",
      },
    ],
  },

  quickstart: {
    kicker: "quickstart",
    title: "Una request y ya estás respondiendo",
    subtitle: "Un POST desde tu backend, desde n8n, desde donde sea.",
    filename: "reply.request",
    replySample: "¡Sí! Te espero a las 15:00 👍",
  },

  // `icon` mapea a un registro en FeaturesGrid. Los items con `hidden: true`
  // NO se renderizan, pero se conservan (junto a su icono) para reusarlos en el
  // futuro — no los borres.
  features: {
    kicker: "features",
    title: "Todo lo que necesitás",
    subtitle: "La API que querías, sin el peso de una plataforma no-code.",
    items: [
      {
        icon: "code",
        title: "Developer-first",
        body: "API limpia, webhooks claros y documentación real. Sin UI innecesaria.",
      },
      {
        icon: "wallet",
        title: "Precio accesible",
        body: "Desde $15/mes contra los $39+ de ManyChat. Pagás por lo que usás.",
        hidden: true,
      },
      {
        icon: "zap",
        title: "Setup en minutos",
        body: "Conectás, configurás el webhook y estás recibiendo mensajes. Sin fricción.",
      },
      {
        icon: "plug",
        title: "Compatible con tu stack",
        body: "Funciona con n8n, Make, Zapier o tu código custom. Vos elegís.",
      },
      {
        icon: "messages",
        title: "Facebook, Instagram y WhatsApp",
        body: "Un solo relay para los tres canales de mensajería de Facebook.",
        hidden: true,
      },
    ],
  },

  pricingPreview: {
    kicker: "pricing",
    title: "Planes simples y transparentes",
    subtitle: "Elegí el que se ajuste a tu volumen. Cambiá cuando quieras.",
    cta: "Ver planes completos",
  },

  about: {
    title: "Por qué construimos Resender",
    body: [
      "Usábamos ManyChat para nuestros propios proyectos, pero solo necesitábamos la API: recibir mensajes y responderlos desde nuestras automatizaciones. Estábamos pagando por un montón de features que nunca abríamos.",
      "Así que construimos lo que nos hubiera gustado tener: un relay directo y pensado para developers. Resender es esa herramienta, ahora disponible para vos.",
    ],
  },

  faq: {
    kicker: "faq",
    title: "Preguntas frecuentes",
    items: [
      {
        q: "¿Con qué canales funciona Resender?",
        a: "Hoy Resender funciona con páginas de Facebook (Messenger). Conectás tu página y empezás a recibir mensajes en tu webhook.",
      },
      {
        q: "¿Necesito aprobación de Facebook para usar Resender?",
        a: "Resender maneja la integración con las APIs de Facebook por vos. Según tu caso de uso puede requerirse revisión de Facebook, pero te guiamos en el proceso.",
      },
      {
        q: "¿Cómo funciona el webhook?",
        a: "Configurás una URL HTTPS por página. Cuando llega un mensaje, Resender lo persiste y lo reenvía a tu endpoint como JSON. Respondés con un POST a nuestra API de salida.",
      },
      {
        q: "¿Puedo usar Resender con n8n, Make o Zapier?",
        a: "Sí. Resender es solo API, así que se integra con cualquier herramienta no-code/low-code o con tu propio código.",
      },
      {
        q: "¿Qué pasa si me paso de los mensajes de mi plan?",
        a: "Te avisamos cuando te acercás al límite y podés subir de plan en cualquier momento sin perder configuración.",
      },
      {
        q: "¿Puedo cambiar de plan en cualquier momento?",
        a: "Sí, podés subir o bajar de plan cuando quieras. Los cambios se aplican en tu próximo ciclo de facturación.",
      },
      {
        q: "¿Qué métodos de pago aceptan?",
        a: "Aceptamos las principales tarjetas de crédito y débito a través de Stripe.",
      },
    ],
  },

  finalCta: {
    title: "¿Listo para empezar?",
    subtitle:
      "Conecta tu primera página y recibe mensajes en minutos. Sin tarjeta para arrancar.",
    cta: "Empezá",
  },

  pricing: {
    kicker: "pricing",
    title: "Precios",
    subtitle:
      "Un plan para cada etapa. Sin contratos, sin sorpresas. Cancelás cuando quieras.",
    plans: [
      {
        name: "Starter",
        price: "$15",
        period: "/mes",
        description: "Para arrancar tu primer proyecto.",
        featured: false,
        badge: null,
        cta: "Empezar con Starter",
        features: [
          "50.000 mensajes por mes",
          "2 páginas de Facebook",
          "Soporte por email + Discord",
        ],
      },
      {
        name: "Pro",
        price: "$25",
        period: "/mes",
        description: "Para devs y agencias en crecimiento.",
        featured: true,
        badge: "Recomendado",
        cta: "Empezar con Pro",
        features: [
          "100.000 mensajes por mes",
          "5 páginas de Facebook",
          "Soporte por email + Discord",
        ],
      },
    ],
  },

  comparison: {
    kicker: "vs manychat",
    title: "Resender vs ManyChat",
    subtitle:
      "Si solo necesitás la API de Facebook, estás pagando de más. Mirá la diferencia.",
    yes: "Sí",
    no: "No",
    headers: { feature: "", resender: "Resender", manychat: "ManyChat" },
    rows: [
      { feature: "Precio de entrada", resender: "$15/mes", manychat: "$39+/mes" },
      { feature: "API limpia y webhooks", resender: true, manychat: true },
      { feature: "Sin builders visuales de más", resender: true, manychat: false },
      { feature: "Enfoque developer-first", resender: true, manychat: false },
      { feature: "Setup en minutos", resender: true, manychat: false },
      { feature: "Integra con n8n / Make / Zapier", resender: true, manychat: true },
      {
        feature: "Templates visuales y analytics de engagement",
        resender: "No los necesitás",
        manychat: true,
      },
    ],
  },

  pricingFaq: {
    kicker: "faq",
    title: "Preguntas sobre precios",
    items: [
      {
        q: "¿Qué pasa si me paso de los mensajes?",
        a: "Te avisamos cuando te acercás al límite. Podés subir de plan sin interrupciones.",
      },
      {
        q: "¿Puedo cambiar de plan?",
        a: "Sí, subís o bajás de plan cuando quieras. Los cambios se prorratean en tu próximo ciclo.",
      },
      {
        q: "¿Hay contrato o compromiso?",
        a: "No. Es mes a mes y cancelás cuando quieras, sin penalidades.",
      },
      {
        q: "¿Qué métodos de pago aceptan?",
        a: "Tarjetas de crédito y débito a través de Stripe.",
      },
    ],
  },

  pricingCta: {
    title: "Empezá a construir hoy",
    subtitle: "Creá tu cuenta y conecta tu primera página en minutos.",
    cta: "Empezá",
  },

  blog: {
    metaTitle: "Blog — Resender",
    metaDescription:
      "Tutoriales y novedades sobre cómo integrar mensajes de Facebook con Resender.",
    title: "Blog",
    subtitle: "Tutoriales y novedades del producto.",
    empty: "Todavía no hay posts publicados.",
    back: "← Volver al blog",
    reading: {
      title: "¿Listo para empezar?",
      subtitle: "Conecta tu primera página y recibe mensajes en minutos.",
      cta: "Empezá",
    },
    categories: { tutorial: "Tutorial", actualizacion: "Novedades" },
    filters: { tutorial: "Tutoriales", actualizacion: "Novedades" },
    filterGroupLabel: "Filtrar entradas",
    emptyCategory: "No hay entradas en esta categoría.",
    tocNavLabel: "Tabla de contenidos",
    tocTitle: "En este artículo",
    rssTitle: "Resender Blog",
    rssDescription: "Tutoriales y novedades de Resender.",
  },

  auth: {
    login: {
      title: "Iniciar sesión",
      subtitle:
        "Ingresá para administrar tus conexiones y el registro de mensajes.",
    },
    register: {
      title: "Crear cuenta",
      subtitle:
        "Creá una cuenta con email y contraseña. En el MVP no hay verificación por email.",
    },
    passwordChanged: "Contraseña actualizada. Ingresá con tu nueva contraseña.",
    form: {
      email: "Email",
      password: "Contraseña",
      emailPlaceholder: "vos@empresa.com",
      passwordPlaceholder: "Al menos 8 caracteres",
      processing: "Procesando...",
      signIn: "Ingresar",
      createAccount: "Crear cuenta",
      noAccount: "¿No tenés cuenta?",
      haveAccount: "¿Ya tenés cuenta?",
      signUp: "Registrate",
      signInAction: "Ingresá",
    },
    errors: {
      invalidCredentials: "Email o contraseña incorrectos.",
      duplicateEmail: "Ese email ya está registrado. Iniciá sesión.",
      invalidInput: "Revisá el email y la contraseña e intentá de nuevo.",
      createdNoSignin: "Creamos la cuenta, pero no pudimos iniciar sesión.",
    },
  },

  footer: {
    tagline: "La API relay para mensajes de Facebook. Simple y developer-first.",
    columns: { product: "Producto", legal: "Legal", contact: "Contacto" },
    links: {
      pricing: "Precios",
      blog: "Blog",
      docs: "Docs",
      privacy: "Privacidad",
      terms: "Términos",
      dataDeletion: "Eliminación de datos",
    },
  },

  meta: {
    home: {
      title: "Resender — La API relay para mensajes de Facebook",
      description:
        "La alternativa developer-first a ManyChat. Recibe mensajes de Facebook en tu webhook y responde por API. Simple y sin features que no usás.",
      ogTitle: "Resender — La API relay para mensajes de Facebook",
      ogDescription:
        "Recibe mensajes de Facebook en tu webhook y responde por API. Simple y developer-first.",
    },
    pricing: {
      title: "Precios — Resender",
      description:
        "Planes desde $15/mes. Compará Resender con ManyChat y elegí el plan que se ajuste a tu volumen de mensajes. Sin contratos.",
      ogTitle: "Precios — Resender",
      ogDescription:
        "Planes simples desde $15/mes. La alternativa developer-first a ManyChat.",
    },
  },
}

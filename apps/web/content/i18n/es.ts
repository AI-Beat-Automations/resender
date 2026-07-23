// Copy centralizado del sitio de marketing (español).
//
// Todo el texto visible de landing y pricing vive acá para poder clonar este
// módulo a `en.ts` y sumar ruteo /en · /es más adelante sin tocar el markup
// (ver plan: i18n "español primero"). Los componentes consumen `dict`.

export const dict = {
  hero: {
    eyebrow: "recibí y respondé mensajes de Facebook por API",
    title: "La API relay para mensajes de Meta.",
    titleAccent: "Developer-first.",
    subtitle:
      "Es simple: conectá tu página, apuntá tu webhook y en minutos empezás a recibir cada mensaje. Respondés con un POST. Sin builders visuales ni features que no usás.",
    ctaPrimary: "Empezá gratis",
    ctaSecondary: "Ver cómo funciona",
  },

  // Sección "El dolor de siempre": un marquee de preguntas/quejas reales que se
  // mueven, y debajo las cards horizontales de pain points. `icon` mapea a un
  // registro en el componente PainPoints.
  pain: {
    title: "El dolor de siempre",
    subtitle: "Si ya intentaste procesar mensajes de Meta, sabés de qué hablamos.",
    // Preguntas/comentarios que se mueven en el marquee (2 renglones).
    questions: [
      "¿Cómo conecto mi n8n a Meta?",
      "Conectar cualquier automatización a Meta es un dolor de cabeza",
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
        title: "Conectar con Meta es un laberinto",
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
    title: "Cómo funciona",
    subtitle: "De cero a recibiendo mensajes en minutos, no en días.",
    steps: [
      {
        title: "Conectá tu página",
        body: "Vinculá tu página de Facebook con un par de clics.",
      },
      {
        title: "Configurá tu webhook",
        body: "Apuntá tu webhook URL y Resender empieza a reenviarte los mensajes entrantes.",
      },
      {
        title: "Recibí los mensajes",
        body: "Cada mensaje llega a tu endpoint como JSON, listo para tu automatización.",
      },
      {
        title: "Respondé por API",
        body: "Hacé un POST de vuelta a Resender y entregamos la respuesta al usuario final.",
      },
    ],
  },

  // `icon` mapea a un registro en FeaturesGrid. Los items con `hidden: true`
  // NO se renderizan, pero se conservan (junto a su icono) para reusarlos en el
  // futuro — no los borres.
  features: {
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
        body: "Un solo relay para los tres canales de mensajería de Meta.",
        hidden: true,
      },
    ],
  },

  pricingPreview: {
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
    title: "Preguntas frecuentes",
    items: [
      {
        q: "¿Con qué canales funciona Resender?",
        a: "Hoy Resender funciona con páginas de Facebook (Messenger). Conectás tu página y empezás a recibir mensajes en tu webhook.",
      },
      {
        q: "¿Necesito aprobación de Meta para usar Resender?",
        a: "Resender maneja la integración con las APIs de Meta por vos. Según tu caso de uso puede requerirse revisión de Meta, pero te guiamos en el proceso.",
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
      "Conectá tu primera página y recibí mensajes en minutos. Sin tarjeta para arrancar.",
    cta: "Empezá gratis",
  },

  pricing: {
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
    title: "Resender vs ManyChat",
    subtitle:
      "Si solo necesitás la API de Meta, estás pagando de más. Mirá la diferencia.",
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
      {
        q: "¿Hay trial gratuito?",
        a: "Podés crear tu cuenta y explorar el producto antes de elegir un plan pago.",
      },
    ],
  },

  pricingCta: {
    title: "Empezá a construir hoy",
    subtitle: "Creá tu cuenta y conectá tu primera página en minutos.",
    cta: "Empezá gratis",
  },
} as const

export type Dict = typeof dict

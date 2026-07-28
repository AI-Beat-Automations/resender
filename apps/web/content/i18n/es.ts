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
    copy: "Copiar código",
    copied: "Copiado",
  },

  pricingPreview: {
    kicker: "pricing",
    title: "Planes simples y transparentes",
    subtitle: "Elegí el que se ajuste a tu volumen. Cambiá cuando quieras.",
    cta: "Ver planes completos",
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
        a: "Desde el 80% de tu cuota te aparece una barra de aviso en el dashboard. Si la agotás, seguimos guardando tus mensajes entrantes pero dejamos de reenviarlos y de aceptar envíos hasta que arranque tu próximo período de facturación. Podés subir de plan en cualquier momento para desbloquearte al instante, sin perder configuración.",
      },
      {
        q: "¿Puedo cambiar de plan en cualquier momento?",
        a: "Sí. Subir de plan se aplica al instante y conservás el consumo del período; bajar de plan se aplica al cierre del período que ya pagaste.",
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
    intro: [
      "Los dos planes incluyen lo mismo: la API completa, webhooks entrantes y salientes, y soporte. Lo único que cambia es cuántos mensajes procesás por mes y cuántas páginas de Facebook conectás.",
      "Un mensaje es cada evento que pasa por el relay, en cualquier dirección: el que te manda un usuario y llega a tu webhook cuenta uno, y tu respuesta por API cuenta otro. Una conversación de ida y vuelta de diez turnos consume veinte mensajes. Los reintentos por webhook caído no se cobran.",
      "Si dudás entre los dos, empezá por Starter. 50.000 mensajes por mes son unas 25.000 conversaciones cortas, de sobra para un proyecto propio o los primeros clientes. Cuando te acerques al límite te avisamos, y subir a Pro es inmediato: no se corta el servicio ni hay que reconectar nada.",
      "Cobramos por mensaje procesado y no por contacto alcanzado, que es la diferencia que más se nota contra ManyChat a medida que crecés: tu factura sigue al tráfico real, no al tamaño acumulado de tu audiencia.",
    ],
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

  vsManychat: {
    kicker: "comparativa",
    title: "Resender vs ManyChat",
    subtitle:
      "Los dos conectan con Facebook Messenger. Uno es una plataforma no-code completa; el otro, el relay de API que necesitás si ya tenés dónde correr tu lógica.",
    intro: [
      "ManyChat es una plataforma de marketing conversacional: builder visual de flujos, secuencias de difusión, plantillas y analítica de engagement. Si tu equipo arma campañas sin escribir código, esa caja de herramientas tiene sentido y la vas a usar entera.",
      "Resender no compite con eso. Hace una sola cosa: te manda cada mensaje entrante de tu página de Facebook a tu webhook, y te deja responder con un POST. La lógica vive donde vos quieras — n8n, Make, un agente de IA o tu propio backend.",
      "La diferencia práctica aparece en la factura y en el techo. En ManyChat pagás desde $39/mes por una plataforma cuyo builder no vas a abrir si tu flujo ya corre en otro lado. En Resender pagás $15/mes por el transporte, y la lógica no tiene más límite que el de tu código.",
    ],
    verdict: {
      title: "Cuál te conviene",
      items: [
        {
          when: "Tu equipo arma los flujos sin programar",
          pick: "ManyChat. El builder visual y las plantillas son exactamente para eso, y reemplazarlos con código te va a costar más de lo que ahorrás.",
        },
        {
          when: "Ya tenés la lógica en n8n, Make, Zapier o tu backend",
          pick: "Resender. Solo te falta el transporte hacia Facebook, y es lo único por lo que vas a pagar.",
        },
        {
          when: "Estás conectando un agente de IA a Facebook",
          pick: "Resender. El agente necesita el mensaje crudo en su webhook y una forma directa de responder, no un builder de por medio.",
        },
        {
          when: "Manejás las páginas de varios clientes",
          pick: "Resender. Conectás varias páginas bajo la misma cuenta y las ruteás por webhook, sin una suscripción por cliente.",
        },
        {
          when: "Necesitás difusiones, secuencias y analítica de engagement",
          pick: "ManyChat. Resender no las tiene y no las va a tener: es infraestructura, no una herramienta de marketing.",
        },
      ],
    },
    faq: {
      title: "Preguntas frecuentes",
      items: [
        {
          q: "¿Resender reemplaza a ManyChat?",
          a: "Solo si usabas ManyChat por su API. Si dependés del builder visual, de las difusiones o de la analítica de engagement, Resender no cubre eso. Si tu flujo ya corre en n8n, Make o tu backend, sí: te queda el mismo resultado sin la plataforma en el medio.",
        },
        {
          q: "¿Cuánto más barato es Resender que ManyChat?",
          a: "Resender arranca en $15/mes con 50.000 mensajes y 2 páginas. El plan Pro de ManyChat arranca en $39/mes y escala con la cantidad de contactos. La diferencia se agranda cuanto más volumen manejás, porque Resender cobra por mensajes y no por contactos.",
        },
        {
          q: "¿Puedo usar Resender con n8n como usaba ManyChat?",
          a: "Sí, y es el caso de uso principal. Apuntás el webhook de Resender a tu workflow de n8n, recibís el mensaje ahí y respondés con un nodo HTTP Request contra la API de Resender.",
        },
        {
          q: "¿Necesito aprobación de Facebook para migrar?",
          a: "Resender ya tiene los permisos de Messenger aprobados, así que conectás tu página con Facebook Login y listo. No pasás por review de app propio.",
        },
        {
          q: "¿Puedo usar los dos a la vez?",
          a: "Técnicamente una página de Facebook manda sus webhooks a una sola app por vez, así que conviene elegir uno por página. Lo que sí podés es tener unas páginas en ManyChat y otras en Resender.",
        },
      ],
    },
    cta: {
      title: "Probá el relay directo",
      subtitle:
        "Conectá tu página, apuntá el webhook y respondé con un POST. Sin contratos.",
      cta: "Empezar",
    },
    metaTitle: "Resender vs ManyChat: la alternativa por API",
    metaDescription:
      "Resender vs ManyChat: $15 contra $39/mes, API y webhooks, y cuál te conviene según uses builder visual o n8n, Make y agentes de IA.",
  },

  pricingFaq: {
    kicker: "faq",
    title: "Preguntas sobre precios",
    items: [
      {
        q: "¿Qué pasa si me paso de los mensajes?",
        a: "Desde el 80% de tu cuota te aparece una barra de aviso en el dashboard. Al agotarla el envío se bloquea hasta tu próximo período de facturación; subir de plan te desbloquea en el acto.",
      },
      {
        q: "¿Puedo cambiar de plan?",
        a: "Sí. Subir de plan se aplica al instante y conservás el consumo del período; bajar de plan se aplica al cierre del período que ya pagaste.",
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
        q: "¿Los reintentos cuentan como mensajes?",
        a: "No. Si tu webhook se cae y reintentamos la entrega, el mensaje se cobra una sola vez. Solo contamos eventos únicos, no intentos de red.",
      },
      {
        q: "¿Puedo conectar más páginas de las que incluye mi plan?",
        a: "El límite de páginas es por plan: 2 en Starter y 5 en Pro. Si necesitás más, subís a Pro o nos escribís y armamos algo a medida para tu volumen.",
      },
      {
        q: "¿Qué pasa con mis datos si cancelo?",
        a: "Tus conexiones quedan inactivas y dejamos de recibir mensajes de tus páginas. Podés pedir la eliminación de tus datos cuando quieras desde la página de eliminación de datos.",
      },
    ],
  },

  pricingCta: {
    title: "Empezá a construir hoy",
    subtitle: "Creá tu cuenta y conecta tu primera página en minutos.",
    cta: "Empezá",
  },

  blog: {
    metaTitle: "Blog: integrar Facebook Messenger por API",
    metaDescription:
      "Tutoriales sobre webhooks, agentes de IA y automatizaciones con n8n, Make y Zapier sobre mensajes de Facebook, más las novedades de Resender.",
    title: "Blog",
    intro:
      "Escribimos sobre lo que nos cruzamos construyendo Resender: cómo ponerle límites a un agente de IA que atiende clientes, cómo elegir un modelo de IA para tu agente y cuántos agentes de IA debería tener tu automatización. Casos concretos, con el código que usamos nosotros.",
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

  // Login y registro son la puerta entre el sitio público y el producto, así
  // que salen del español hardcodeado del dashboard y viven acá (ADR 0006). El
  // registro es el del producto —tuteo neutro, ADR 0005—, no el voseo del
  // landing: el texto es el mismo que dibujó la consola v2.
  auth: {
    login: {
      eyebrow: "acceso",
      title: "Iniciar sesión",
      subtitle: "Entra para administrar tus conexiones y el log de mensajes.",
    },
    register: {
      eyebrow: "alta",
      title: "Crear cuenta",
      subtitle: "Email y contraseña. No hay verificación por correo en el MVP.",
    },
    passwordChanged: "Contraseña actualizada. Inicia sesión con la nueva.",
    form: {
      email: "Email",
      password: "Contraseña",
      emailPlaceholder: "tu@empresa.com",
      passwordPlaceholder: "Al menos 8 caracteres",
      passwordHint: "Al menos 8 caracteres.",
      processing: "Procesando…",
      signIn: "Entrar",
      createAccount: "Crear cuenta",
      noAccount: "¿No tienes cuenta?",
      haveAccount: "¿Ya tienes cuenta?",
      signUp: "Crear una",
      signInAction: "Iniciar sesión",
    },
    errors: {
      invalidCredentials: "Email o contraseña incorrectos.",
      duplicateEmail: "Ese email ya está registrado. Inicia sesión.",
      invalidInput: "Revisa el email y la contraseña e inténtalo de nuevo.",
      createdNoSignin:
        "Creamos tu cuenta, pero no pudimos iniciar la sesión. Entra desde Iniciar sesión.",
    },
  },

  footer: {
    tagline: "La API relay para mensajes de Facebook. Simple y developer-first.",
    columns: { product: "Producto", legal: "Legal", contact: "Contacto" },
    links: {
      pricing: "Precios",
      vsManychat: "vs ManyChat",
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
      title: "Precios y planes desde $15 por mes",
      description:
        "Planes de Resender desde $15/mes con 50.000 mensajes y 2 páginas de Facebook. Sin contratos, sin cargo por contacto y cancelás cuando quieras.",
      ogTitle: "Precios y planes desde $15 por mes",
      ogDescription:
        "Planes simples desde $15/mes. La alternativa developer-first a ManyChat.",
    },
  },

  llms: {
    summary:
      "La API relay para mensajes de Facebook. Conectás tu página, apuntás tu webhook y respondés con un POST — sin builders visuales ni features que no usás. Alternativa developer-first a ManyChat, desde $15/mes. Operado por AI Beat.",
    context: [
      "Resender resuelve un problema puntual: recibir en tu propio servidor los mensajes que llegan a una página de Facebook (Messenger) y responderlos por API. La lógica corre donde vos quieras — n8n, Make, Zapier, un agente de IA o tu propio backend — y Resender se encarga solo del transporte hacia y desde Facebook.",
      "Cómo funciona: conectás tu página con Facebook Login, configurás una URL HTTPS por página, cada mensaje entrante llega a ese endpoint como JSON, y respondés con un POST a la API de salida de Resender. Los permisos de Messenger ya están aprobados, así que no pasás por un review de app propio.",
      "Qué NO es: Resender no tiene builder visual de flujos, difusiones, plantillas ni analítica de engagement. Si necesitás eso, ManyChat es la mejor opción y así lo decimos en la comparativa.",
      "Precios: Starter $15/mes (50.000 mensajes, 2 páginas de Facebook) y Pro $25/mes (100.000 mensajes, 5 páginas). Se cobra por mensaje procesado en cualquier dirección, no por contacto alcanzado. Los reintentos por webhook caído no se cobran. Sin contratos: es mes a mes.",
      "El sitio está en español en la raíz y en inglés bajo /en. Las páginas legales existen solo en español.",
    ],
    sections: {
      product: "Producto",
      docs: "Documentación",
      blog: "Blog",
      legal: "Legal",
      optional: "Optional",
    },
    entries: {
      home: {
        label: "Inicio",
        detail:
          "Qué es Resender, el flujo de cuatro pasos, el quickstart con la request de respuesta y las preguntas frecuentes.",
      },
      pricing: {
        label: "Precios",
        detail:
          "Planes Starter y Pro, qué cuenta como mensaje, cómo se factura y preguntas sobre facturación.",
      },
      vsManychat: {
        label: "Resender vs ManyChat",
        detail:
          "Comparación de precio y alcance contra ManyChat, y en qué casos conviene cada uno.",
      },
      blog: {
        label: "Blog",
        detail:
          "Tutoriales sobre webhooks, agentes de IA y automatizaciones con n8n, Make y Zapier, más las novedades del producto.",
      },
      docs: {
        label: "Documentación técnica",
        detail:
          "Referencia de la API: autenticación, formato del webhook entrante y endpoint de respuesta. Vive en su propio subdominio.",
      },
      privacy: {
        label: "Política de privacidad",
        detail: "Qué datos guarda Resender y por cuánto tiempo.",
      },
      terms: {
        label: "Términos del servicio",
        detail: "Condiciones de uso de Resender, operado por AI Beat.",
      },
      dataDeletion: {
        label: "Eliminación de datos",
        detail: "Cómo pedir la baja de tus datos.",
      },
      full: {
        label: "Contenido completo del sitio",
        detail:
          "Todo el texto de las páginas y de los artículos del blog en un solo archivo markdown.",
      },
      otherLocale: {
        label: "English version",
        detail: "El mismo índice, con las URLs de la versión en inglés del sitio.",
      },
      rss: {
        label: "RSS del blog",
        detail: "Feed de los artículos en español.",
      },
    },
    fullFile: {
      title: "Resender — contenido completo",
      note: "Volcado del texto completo del sitio y del blog. El índice curado y más corto está en {index}. Última actualización: {date}.",
      postsTitle: "Artículos del blog",
      sourceLabel: "Fuente",
      publishedLabel: "Publicado",
      plansTitle: "Planes",
      comparisonTitle: "Tabla comparativa",
    },
  },
}

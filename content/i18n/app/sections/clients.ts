// `/clientes` (issue #154): el padre crea, invita y administra clientes.
export type ClientsDict = {
  title: string
  subtitle: string
  /** Aviso para Starter y Free: sin CTA de compra. */
  gateTitle: string
  gateBody: string
  createTitle: string
  createBody: string
  nameLabel: string
  namePlaceholder: string
  emailLabel: string
  emailPlaceholder: string
  maxLabel: string
  /** `{maxPages}`: el máximo del plan del padre. */
  maxHint: string
  create: string
  creating: string
  listTitle: string
  listBody: string
  empty: string
  headName: string
  headEmail: string
  headStatus: string
  headUsage: string
  headActions: string
  statusPending: string
  statusActive: string
  /** Nota bajo «Pendiente» cuando no queda invitación viva. */
  invitationCancelledNote: string
  invitationExpiredNote: string
  /** `{connected}` y `{max}`. */
  usage: string
  resend: string
  resending: string
  cancelInvitation: string
  cancelling: string
  editMax: string
  editMaxTitle: string
  editMaxBody: string
  editMaxSave: string
  editMaxSaving: string
  delete: string
  /** `{name}`. */
  deleteTitle: string
  deleteBody: string
  deleteConnectionsIntro: string
  deleteNoConnections: string
  deleteConfirm: string
  deleting: string
  invitationEmail: {
    /** `{owner}`: el nombre del padre. */
    subject: string
    preheader: string
    /** `{name}`: el nombre del cliente que escribió el padre. */
    greeting: string
    /** `{owner}`. */
    intro: string
    ctaLabel: string
    expiryNote: string
    fallbackLabel: string
    ignoreNote: string
    footerNote: string
  }
}

export const es: ClientsDict = {
  title: "Clientes",
  subtitle:
    "Crea un espacio para cada negocio que administras. El cliente conecta sus redes con su propio login de Meta y tú las ves en Conexiones e Inbox.",
  gateTitle: "Clientes es una función de los planes Pro y Business",
  gateBody:
    "Con tu plan actual no puedes invitar clientes. Puedes ver tu plan en Ajustes → Suscripción.",
  createTitle: "Nuevo cliente",
  createBody:
    "Al guardar, el cliente recibe un correo con un enlace para crear su acceso. El enlace vence en 7 días.",
  nameLabel: "Nombre",
  namePlaceholder: "Panadería Sol",
  emailLabel: "Correo",
  emailPlaceholder: "cliente@negocio.com",
  maxLabel: "Tope de conexiones",
  maxHint: "Entre 1 y {maxPages}, el máximo de tu plan.",
  create: "Crear e invitar",
  creating: "Creando…",
  listTitle: "Tus clientes",
  listBody:
    "Estado de cada invitación y cuántas conexiones tiene cada cliente frente a su tope.",
  empty: "Todavía no tienes clientes. Crea el primero arriba.",
  headName: "NOMBRE",
  headEmail: "CORREO",
  headStatus: "ESTADO",
  headUsage: "CONECTADAS / TOPE",
  headActions: "Acciones",
  statusPending: "Pendiente",
  statusActive: "Activo",
  invitationCancelledNote: "Invitación cancelada",
  invitationExpiredNote: "Invitación vencida",
  usage: "{connected} / {max}",
  resend: "Reenviar",
  resending: "Reenviando…",
  cancelInvitation: "Cancelar invitación",
  cancelling: "Cancelando…",
  editMax: "Editar tope",
  editMaxTitle: "Tope de conexiones de {name}",
  editMaxBody:
    "Puedes bajarlo por debajo de lo que ya tiene conectado: no se desconecta nada, pero la celda se marca en rojo hasta que el cliente libere conexiones.",
  editMaxSave: "Guardar tope",
  editMaxSaving: "Guardando…",
  delete: "Eliminar",
  deleteTitle: "¿Eliminar a {name}?",
  deleteBody:
    "Se elimina su acceso, sus conexiones y todo su historial. Esta acción no se puede deshacer.",
  deleteConnectionsIntro: "Se van a desconectar estas conexiones:",
  deleteNoConnections: "Este cliente no tiene conexiones activas.",
  deleteConfirm: "Sí, eliminar cliente",
  deleting: "Eliminando…",
  invitationEmail: {
    subject: "{owner} te invita a Resender",
    preheader:
      "Crea tu acceso para conectar tus redes. El enlace vence en 7 días.",
    greeting: "Hola {name},",
    intro:
      "{owner} te invitó a Resender para que conectes tus cuentas de Messenger, Instagram o WhatsApp con tu propio login de Meta. Crea tu acceso con el botón de abajo.",
    ctaLabel: "Crear mi acceso",
    expiryNote: "El enlace vence en 7 días.",
    fallbackLabel: "¿No funciona el botón? Copia esta dirección:",
    ignoreNote:
      "Si no esperabas esta invitación, ignora este mensaje: nadie puede crear un acceso con tu correo sin este enlace.",
    footerNote: "Resender · resender.dev",
  },
}

export const en: ClientsDict = {
  title: "Clients",
  subtitle:
    "Create a space for each business you manage. The client connects their accounts with their own Meta login and you see them in Connections and Inbox.",
  gateTitle: "Clients is a Pro and Business feature",
  gateBody:
    "Your current plan can't invite clients. You can check your plan in Settings → Subscription.",
  createTitle: "New client",
  createBody:
    "On save, the client gets an email with a link to create their access. The link expires in 7 days.",
  nameLabel: "Name",
  namePlaceholder: "Sol Bakery",
  emailLabel: "Email",
  emailPlaceholder: "client@business.com",
  maxLabel: "Connection limit",
  maxHint: "Between 1 and {maxPages}, your plan's maximum.",
  create: "Create and invite",
  creating: "Creating…",
  listTitle: "Your clients",
  listBody:
    "Each invitation's status and how many connections each client has against their limit.",
  empty: "No clients yet. Create the first one above.",
  headName: "NAME",
  headEmail: "EMAIL",
  headStatus: "STATUS",
  headUsage: "CONNECTED / LIMIT",
  headActions: "Actions",
  statusPending: "Pending",
  statusActive: "Active",
  invitationCancelledNote: "Invitation cancelled",
  invitationExpiredNote: "Invitation expired",
  usage: "{connected} / {max}",
  resend: "Resend",
  resending: "Resending…",
  cancelInvitation: "Cancel invitation",
  cancelling: "Cancelling…",
  editMax: "Edit limit",
  editMaxTitle: "Connection limit for {name}",
  editMaxBody:
    "You can set it below what they already have connected: nothing gets disconnected, but the cell turns red until the client frees up connections.",
  editMaxSave: "Save limit",
  editMaxSaving: "Saving…",
  delete: "Delete",
  deleteTitle: "Delete {name}?",
  deleteBody:
    "Their access, their connections and all their history will be removed. This cannot be undone.",
  deleteConnectionsIntro: "These connections will be disconnected:",
  deleteNoConnections: "This client has no active connections.",
  deleteConfirm: "Yes, delete client",
  deleting: "Deleting…",
  invitationEmail: {
    subject: "{owner} invited you to Resender",
    preheader:
      "Create your access to connect your accounts. The link expires in 7 days.",
    greeting: "Hi {name},",
    intro:
      "{owner} invited you to Resender so you can connect your Messenger, Instagram or WhatsApp accounts with your own Meta login. Create your access with the button below.",
    ctaLabel: "Create my access",
    expiryNote: "The link expires in 7 days.",
    fallbackLabel: "Button not working? Copy this address:",
    ignoreNote:
      "If you weren't expecting this invitation, ignore this message: nobody can create an access with your email without this link.",
    footerNote: "Resender · resender.dev",
  },
}

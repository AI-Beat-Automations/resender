import type { WhatsappTemplateCategory } from "@/lib/meta/whatsapp-template-client"
import type { WhatsappTemplateStatus } from "@/lib/whatsapp-templates/template-store"

// `/templates` (issue #195): el catálogo de plantillas de WhatsApp de los
// números del actor, de solo lectura. El editor llega en otro ticket.
export type TemplatesDict = {
  title: string
  subtitle: string
  numberPickerLabel: string
  numberPickerSearch: string
  numberPickerEmpty: string
  columnName: string
  columnLanguage: string
  columnCategory: string
  columnStatus: string
  columnBody: string
  columnOwnership: string
  /** La creó este mismo actor desde Resender. */
  owned: string
  readOnly: string
  /** Tooltip de la marca de solo lectura. */
  readOnlyHint: string
  noCategory: string
  noBody: string
  category: Record<WhatsappTemplateCategory, string>
  status: Record<WhatsappTemplateStatus, string>
  emptyNumbersTitle: string
  emptyNumbersBody: string
  emptyNumbersCta: string
  emptyTemplatesTitle: string
  emptyTemplatesBody: string
}

export const es: TemplatesDict = {
  title: "Plantillas",
  subtitle:
    "Las plantillas de WhatsApp de las WABAs de tus números. El estado se actualiza solo cuando Meta la revisa; recarga para verlo.",
  numberPickerLabel: "Número de WhatsApp",
  numberPickerSearch: "Buscar número…",
  numberPickerEmpty: "Sin resultados",
  columnName: "Nombre",
  columnLanguage: "Idioma",
  columnCategory: "Categoría",
  columnStatus: "Estado",
  columnBody: "Cuerpo",
  columnOwnership: "Edición",
  owned: "Propia",
  readOnly: "Solo lectura",
  readOnlyHint: "Solo lectura · se edita en WhatsApp Manager",
  noCategory: "—",
  noBody: "Sin cuerpo",
  category: {
    utility: "Utilidad",
    marketing: "Marketing",
    authentication: "Autenticación",
  },
  status: {
    APPROVED: "Aprobada",
    PENDING: "Pendiente",
    IN_REVIEW: "En revisión",
    REJECTED: "Rechazada",
    PAUSED: "Pausada",
    DISABLED: "Deshabilitada",
    IN_APPEAL: "En apelación",
    LIMIT_EXCEEDED: "Límite excedido",
    PENDING_DELETION: "Borrándose",
    DELETED: "Borrada",
    ARCHIVED: "Archivada",
    unknown: "Desconocido",
  },
  emptyNumbersTitle: "Sin números de WhatsApp",
  emptyNumbersBody:
    "Las plantillas viven en la WABA de un número. Conecta un número de WhatsApp para ver las suyas.",
  emptyNumbersCta: "Ir a Conexiones",
  emptyTemplatesTitle: "Sin plantillas",
  emptyTemplatesBody:
    "La WABA de este número todavía no tiene plantillas, o aún no terminó de sincronizarse.",
}

export const en: TemplatesDict = {
  title: "Templates",
  subtitle:
    "The WhatsApp templates in your numbers' WABAs. Status updates on its own when Meta reviews a template; reload to see it.",
  numberPickerLabel: "WhatsApp number",
  numberPickerSearch: "Search number…",
  numberPickerEmpty: "No results",
  columnName: "Name",
  columnLanguage: "Language",
  columnCategory: "Category",
  columnStatus: "Status",
  columnBody: "Body",
  columnOwnership: "Editing",
  owned: "Yours",
  readOnly: "Read-only",
  readOnlyHint: "Read-only · edit it in WhatsApp Manager",
  noCategory: "—",
  noBody: "No body",
  category: {
    utility: "Utility",
    marketing: "Marketing",
    authentication: "Authentication",
  },
  status: {
    APPROVED: "Approved",
    PENDING: "Pending",
    IN_REVIEW: "In review",
    REJECTED: "Rejected",
    PAUSED: "Paused",
    DISABLED: "Disabled",
    IN_APPEAL: "In appeal",
    LIMIT_EXCEEDED: "Limit exceeded",
    PENDING_DELETION: "Deleting",
    DELETED: "Deleted",
    ARCHIVED: "Archived",
    unknown: "Unknown",
  },
  emptyNumbersTitle: "No WhatsApp numbers",
  emptyNumbersBody:
    "Templates live in a number's WABA. Connect a WhatsApp number to see its templates.",
  emptyNumbersCta: "Go to Connections",
  emptyTemplatesTitle: "No templates",
  emptyTemplatesBody:
    "This number's WABA has no templates yet, or it hasn't finished syncing.",
}

import type { WhatsappTemplateCategory } from "@/lib/meta/whatsapp-template-client"
import type { TemplateDraftErrorCode } from "@/lib/whatsapp-templates/template-draft"
import type { TemplateMetaErrorKey } from "@/lib/whatsapp-templates/template-editor"
import type { WhatsappTemplateStatus } from "@/lib/whatsapp-templates/template-store"

// `/templates` (issue #195): el catálogo de plantillas de WhatsApp de los
// números del actor. El editor y el borrado de las propias, issue #196.
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
  columnActions: string
  newTemplate: string
  edit: string
  delete: string
  createTitle: string
  createDescription: string
  /** `{name}`, `{language}` */
  editTitle: string
  editDescription: string
  fieldName: string
  fieldNameHint: string
  fieldLanguage: string
  fieldLanguageHint: string
  fieldCategory: string
  fieldBody: string
  fieldBodyHint: string
  /** `{variable}`: el marcador, `{{1}}`. */
  fieldExample: string
  fieldExamplesHint: string
  fieldFooter: string
  /** Al editar: la copia local no guarda el pie, y la edición lo reemplaza. */
  fieldFooterEditHint: string
  preview: string
  create: string
  creating: string
  save: string
  saving: string
  back: string
  confirmEditTitle: string
  confirmEditReview: string
  confirmEditSubmit: string
  /** `{name}`, `{language}` */
  deleteTitle: string
  /** `{language}` */
  deleteBody: string
  deleteConfirm: string
  deleting: string
  /** `{count}`: números fuera del alcance del actor que ya la enviaron. */
  usedByOtherNumbers: string
  numberNotConnected: string
  notFound: string
  notOwned: string
  missingMetaId: string
  /** `{message}`: el mensaje de Meta tal cual, cuando no hay traducción. */
  metaRejected: string
  draftErrors: Record<TemplateDraftErrorCode, string>
  metaErrors: Record<TemplateMetaErrorKey, string>
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
  columnActions: "Acciones",
  newTemplate: "Nueva plantilla",
  edit: "Editar",
  delete: "Borrar",
  createTitle: "Nueva plantilla",
  createDescription:
    "Se crea en la WABA de este número y Meta la revisa antes de que se pueda enviar.",
  editTitle: "Editar {name} ({language})",
  editDescription:
    "El nombre, el idioma y la categoría no se cambian. Toda edición vuelve a revisión de Meta.",
  fieldName: "Nombre",
  fieldNameHint: "Minúsculas, números y guion bajo. Ejemplo: aviso_cita",
  fieldLanguage: "Idioma",
  fieldLanguageHint: "Código de WhatsApp. Ejemplo: es_MX o en_US",
  fieldCategory: "Categoría",
  fieldBody: "Cuerpo",
  fieldBodyHint:
    "Usa {{1}}, {{2}}… para las variables, en orden y sin saltarte números. No pueden abrir ni cerrar el texto.",
  fieldExample: "Ejemplo de {variable}",
  fieldExamplesHint: "Meta rechaza una plantilla sin un ejemplo por variable.",
  fieldFooter: "Pie (opcional)",
  fieldFooterEditHint:
    "Resender no guarda el pie actual: si la plantilla tenía uno, vuelve a escribirlo o se quita.",
  preview: "Vista previa",
  create: "Crear plantilla",
  creating: "Creando…",
  save: "Guardar",
  saving: "Guardando…",
  back: "Volver",
  confirmEditTitle: "¿Guardar los cambios?",
  confirmEditReview:
    "Esta plantilla está aprobada. Al editarla vuelve a revisión y no se puede enviar hasta que Meta la apruebe de nuevo.",
  confirmEditSubmit: "Guardar de todos modos",
  deleteTitle: "¿Borrar {name} ({language})?",
  deleteBody:
    "Se borra solo el idioma {language}; las otras traducciones siguen. El nombre queda bloqueado 30 días: no podrás crear otra plantilla con él.",
  deleteConfirm: "Borrar plantilla",
  deleting: "Borrando…",
  usedByOtherNumbers:
    "La usaron {count} números más de esta WABA: el cambio también les llega a ellos.",
  numberNotConnected: "Este número ya no está conectado. Recarga la página.",
  notFound: "No encontramos esa plantilla.",
  notOwned:
    "Esta plantilla no la creaste tú desde Resender: se edita en WhatsApp Manager.",
  missingMetaId:
    "Todavía no tenemos el id de WhatsApp de esta plantilla, así que no se cambió. Prueba en unos minutos o hazlo en WhatsApp Manager.",
  metaRejected: "WhatsApp rechazó la plantilla: {message}",
  draftErrors: {
    template_name_invalid:
      "El nombre solo admite minúsculas, números y guion bajo (hasta 512). Ejemplo: aviso_cita",
    template_language_invalid:
      "El idioma tiene que ser un código de WhatsApp, como es_MX o en_US.",
    template_category_invalid: "Elige Utilidad o Marketing.",
    template_body_missing: "Escribe el cuerpo de la plantilla.",
    template_body_too_long: "El cuerpo pasa de 1024 caracteres.",
    template_variable_invalid:
      "Hay una variable mal escrita: usa {{1}}, {{2}}…",
    template_variables_not_sequential:
      "Las variables van en orden desde {{1}}, sin saltarte números.",
    template_variable_at_edge:
      "El cuerpo no puede empezar ni terminar con una variable: agrega texto antes y después.",
    template_examples_mismatch: "Falta un ejemplo por variable.",
    template_example_empty:
      "Completa el ejemplo de cada variable: Meta rechaza la plantilla sin ellos.",
    template_footer_invalid:
      "El pie es texto de hasta 60 caracteres, sin variables.",
  },
  metaErrors: {
    tokenExpired:
      "El acceso de Meta de este número venció. Vuelve a conectarlo desde Conexiones.",
    limitReached:
      "La WABA llegó a su tope de plantillas (250 sin verificar, hasta 6000 verificada). Borra las que no uses o verifica el negocio en Meta.",
    underReview:
      "WhatsApp todavía está revisando esta plantilla y no se puede editar. Prueba cuando termine la revisión.",
    fieldTooLong:
      "Un campo de la plantilla es más largo de lo que WhatsApp permite.",
    bodyFormat: "WhatsApp rechazó el formato del cuerpo.",
    footerFormat: "WhatsApp rechazó el formato del pie.",
    tooManyVariables:
      "Hay demasiadas variables para lo largo del texto: agrega más texto fijo alrededor.",
    variableAtEdge:
      "Las variables no pueden ir al principio ni al final del cuerpo.",
  },
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
  columnActions: "Actions",
  newTemplate: "New template",
  edit: "Edit",
  delete: "Delete",
  createTitle: "New template",
  createDescription:
    "It's created in this number's WABA, and Meta reviews it before it can be sent.",
  editTitle: "Edit {name} ({language})",
  editDescription:
    "Name, language and category can't change. Every edit goes back to Meta's review.",
  fieldName: "Name",
  fieldNameHint:
    "Lowercase letters, numbers and underscores. Example: appointment_reminder",
  fieldLanguage: "Language",
  fieldLanguageHint: "WhatsApp code. Example: en_US or es_MX",
  fieldCategory: "Category",
  fieldBody: "Body",
  fieldBodyHint:
    "Use {{1}}, {{2}}… for variables, in order and without skipping numbers. They can't start or end the text.",
  fieldExample: "Example for {variable}",
  fieldExamplesHint:
    "Meta rejects a template without one example per variable.",
  fieldFooter: "Footer (optional)",
  fieldFooterEditHint:
    "Resender doesn't keep the current footer: if the template had one, type it again or it's removed.",
  preview: "Preview",
  create: "Create template",
  creating: "Creating…",
  save: "Save",
  saving: "Saving…",
  back: "Back",
  confirmEditTitle: "Save the changes?",
  confirmEditReview:
    "This template is approved. Editing it sends it back to review, and it can't be sent until Meta approves it again.",
  confirmEditSubmit: "Save anyway",
  deleteTitle: "Delete {name} ({language})?",
  deleteBody:
    "Only the {language} language is deleted; other translations stay. The name stays locked for 30 days: you can't create another template with it.",
  deleteConfirm: "Delete template",
  deleting: "Deleting…",
  usedByOtherNumbers:
    "{count} other numbers in this WABA have used it: the change reaches them too.",
  numberNotConnected: "This number is no longer connected. Reload the page.",
  notFound: "We couldn't find that template.",
  notOwned:
    "You didn't create this template from Resender: edit it in WhatsApp Manager.",
  missingMetaId:
    "We don't have this template's WhatsApp id yet, so it wasn't changed. Try again in a few minutes, or do it in WhatsApp Manager.",
  metaRejected: "WhatsApp rejected the template: {message}",
  draftErrors: {
    template_name_invalid:
      "The name only allows lowercase letters, numbers and underscores (up to 512). Example: appointment_reminder",
    template_language_invalid:
      "The language must be a WhatsApp code, like en_US or es_MX.",
    template_category_invalid: "Choose Utility or Marketing.",
    template_body_missing: "Write the template body.",
    template_body_too_long: "The body is longer than 1024 characters.",
    template_variable_invalid: "A variable is misspelled: use {{1}}, {{2}}…",
    template_variables_not_sequential:
      "Variables go in order from {{1}}, without skipping numbers.",
    template_variable_at_edge:
      "The body can't start or end with a variable: add text before and after it.",
    template_examples_mismatch: "One example per variable is missing.",
    template_example_empty:
      "Fill in the example for every variable: Meta rejects the template without them.",
    template_footer_invalid:
      "The footer is text of up to 60 characters, without variables.",
  },
  metaErrors: {
    tokenExpired:
      "This number's Meta access expired. Reconnect it from Connections.",
    limitReached:
      "The WABA reached its template limit (250 unverified, up to 6,000 verified). Delete templates you don't use or verify the business in Meta.",
    underReview:
      "WhatsApp is still reviewing this template, so it can't be edited yet. Try again when the review finishes.",
    fieldTooLong: "A field of the template is longer than WhatsApp allows.",
    bodyFormat: "WhatsApp rejected the formatting of the body.",
    footerFormat: "WhatsApp rejected the formatting of the footer.",
    tooManyVariables:
      "There are too many variables for the text's length: add more fixed text around them.",
    variableAtEdge: "Variables can't be at the start or the end of the body.",
  },
}

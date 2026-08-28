"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/auth"
import { fmt } from "@/content/i18n/app"
import { resolveWhatsappAccess } from "@/lib/auth/channel-access"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { hasActiveSubscription } from "@/lib/billing/subscription"
import { getAppDict } from "@/lib/i18n/app-dict"
import {
  createWhatsappTemplateForTenant,
  deleteWhatsappTemplateForTenant,
  parseWhatsappTemplateDraft,
  parseWhatsappTemplateEdit,
  updateWhatsappTemplateForTenant,
} from "@/lib/whatsapp-templates/template-admin"
import { describeWhatsappTemplateFailure } from "@/lib/whatsapp-templates/template-console"
import { buildWhatsappTemplateComponents } from "@/lib/whatsapp-templates/template-form"

// Las tres operaciones que la pantalla de plantillas puede hacer sobre el
// catálogo de un número: crear, editar y borrar.
//
// **Llaman a `lib/*` directo y no a `/api/meta/whatsapp/templates`.** Así
// funciona toda la consola desde la ADR 0012 —un solo Worker, ninguna pantalla
// hace `fetch` a la propia API pública— y así se autentica: con `auth()` de la
// sesión, no con una API key. Por eso no aparece por acá
// `runWhatsappTemplateAdminGates`, que es la antesala de las rutas y valida un
// `Authorization: Bearer` que una sesión de navegador no tiene. Lo que sí se
// reusa de esa antesala es **la secuencia**: los mismos tres permisos, en el
// mismo orden, resueltos con la autenticación de la consola
// (`authorizeWhatsappTemplateWrite`).
//
// **La orquestación no se duplica: se consume.** Resolver la WABA del número,
// comprobar quién creó la plantilla, llamar a Graph y espejar el resultado es
// exactamente lo mismo acá y en la API pública, y vive una sola vez en
// `template-admin.ts`. Lo que sí es propio de este archivo son dos cosas que la
// ruta no necesita: el estado de formulario que consume `useActionState`, y la
// traducción del rechazo al idioma del usuario —la API pública contesta en
// inglés a un integrador; una persona mirando la consola no tiene por qué leerlo
// en inglés—.
//
// Ningún dato del cliente final sale de acá hacia un log: el nombre de la
// plantilla se puede nombrar, los `components` no (ADR 0014).

/**
 * El estado compartido por los tres formularios.
 *
 * `error` y `detail` son dos niveles a propósito: el primero está traducido y
 * dice qué pasó en el vocabulario del producto, y el segundo es el texto crudo
 * de Meta, que sólo aparece cuando nuestra traducción no puede ser específica
 * —un rechazo de Graph— y es lo único que dice qué arreglar.
 */
export type WhatsappTemplateActionState = {
  error?: string
  detail?: string
  message?: string
}

/** Quién escribe, o el estado de formulario que dice por qué no puede. */
type WhatsappTemplateWriteGate =
  | { ok: true; tenantId: string }
  | { ok: false; state: WhatsappTemplateActionState }

/**
 * Los permisos que hacen falta para **escribir** en el catálogo: sesión,
 * permiso de canal, waitlist y suscripción activa, en el mismo orden que
 * `runWhatsappTemplateAdminGates` aplica en la API pública. Son la misma
 * decisión pedida por otra puerta, así que divergir en el orden o en el
 * catálogo produciría dos productos distintos según por dónde se entre.
 *
 * **Por qué se vuelve a comprobar lo que la pantalla ya comprobó.** Porque no
 * lo comprobó: `app/(product)/layout.tsx` gatea el **render**, y una Server
 * Action es un `POST` a la ruta que se ejecuta *antes* de que ese layout vuelva
 * a dibujarse. El redirect a `/billing` que ve el usuario después de la
 * mutación llega tarde: la plantilla ya se creó en la WABA. Una Server Action
 * es una superficie propia —invocable con un `fetch` al id de la acción, sin
 * pasar por la pantalla— y por eso repite el gate en vez de heredarlo. Esto no
 * es defensa en profundidad decorativa: es el único gate que existe en este
 * camino.
 *
 * **Los tres, y no sólo la suscripción.** Ese es el que el ticket exige y el
 * que tiene la consecuencia más cara —crear deja efectos permanentes en la WABA
 * del cliente: el nombre queda tomado 30 días y cuenta contra su tope—, pero
 * los otros dos se aplican por la misma razón que en `connect-whatsapp`:
 * quitarle a una cuenta el permiso de WhatsApp tiene que cerrar **todas** las
 * puertas del canal, no sólo la de conectar. Los tres helpers fallan cerrados,
 * así que un fallo de base bloquea la escritura en vez de dejarla pasar.
 *
 * La **lectura** no pasa por acá: listar el catálogo no deja efecto en la WABA
 * ni gasta rate limit de Meta —sale del espejo—, y la pantalla que lo muestra sí
 * está detrás del layout. Un moroso que llega a `/templates` ya fue redirigido a
 * `/billing` antes de ver la lista.
 */
async function authorizeWhatsappTemplateWrite(
  t: Awaited<ReturnType<typeof getAppDict>>
): Promise<WhatsappTemplateWriteGate> {
  const session = await auth()
  const tenantId = session?.user?.id
  if (!tenantId) return { ok: false, state: { error: t.actions.notSignedIn } }

  if (!(await resolveWhatsappAccess(tenantId))) {
    return { ok: false, state: { error: t.actions.whatsappNotEnabled } }
  }

  if (await isUserWaitlisted(tenantId)) {
    return { ok: false, state: { error: t.actions.waitlisted } }
  }

  if (!(await hasActiveSubscription(tenantId))) {
    return { ok: false, state: { error: t.actions.noSubscription } }
  }

  return { ok: true, tenantId }
}

/**
 * Crea una plantilla en la WABA del número y la espeja.
 *
 * Los `components` se arman con `buildWhatsappTemplateComponents` y se validan
 * con `parseWhatsappTemplateDraft`, **la misma función que valida el `POST` de
 * la API pública**. Una segunda validación escrita para la consola sería una
 * segunda opinión sobre qué acepta Meta, y las dos opiniones divergen el día que
 * alguien arregla una sola.
 */
export async function createWhatsappTemplateAction(
  _state: WhatsappTemplateActionState,
  formData: FormData
): Promise<WhatsappTemplateActionState> {
  const t = await getAppDict()
  const gate = await authorizeWhatsappTemplateWrite(t)
  if (!gate.ok) return gate.state

  const draft = parseWhatsappTemplateDraft({
    pageId: readField(formData, "pageId"),
    name: readField(formData, "name"),
    language: readField(formData, "language"),
    category: readField(formData, "category"),
    components: buildWhatsappTemplateComponents({
      body: readField(formData, "body"),
      footer: readField(formData, "footer"),
      // `getAll` conserva el orden del DOM, y el formulario dibuja una casilla
      // por variable **ordenada por número**, así que el índice 0 es el ejemplo
      // de `{{1}}` sin que haga falta enviar la posición aparte.
      examples: formData.getAll("example").map(readEntry),
    }),
  })

  if (!draft.ok) return toActionError(draft, t)

  const created = await createWhatsappTemplateForTenant({
    tenantId: gate.tenantId,
    ...draft.value,
  })

  if (!created.ok) return toActionError(created, t)

  revalidatePath("/templates")

  // `mirrored: false` es «Meta la creó y nuestro espejo no se enteró». No es un
  // error —la plantilla existe y se puede enviar— pero sí cambia lo que el
  // usuario va a ver: hasta que el sync la recupere aparece como ajena y no se
  // puede editar ni borrar desde acá. Decirlo evita el ticket de «creé una
  // plantilla y la consola no me deja tocarla».
  return {
    message: fmt(
      created.mirrored ? t.templates.created : t.templates.createdNotMirrored,
      { name: created.template.name }
    ),
  }
}

/**
 * Reemplaza el contenido de una plantilla propia.
 *
 * **El aviso de que vuelve a revisión no se da acá**: cuando esta acción
 * contesta, la plantilla ya está editada y ya dejó de poder enviarse. El aviso
 * es de la pantalla y va antes de guardar (user story 5); lo que devuelve esta
 * acción es la confirmación de lo que ya ocurrió.
 */
export async function updateWhatsappTemplateAction(
  _state: WhatsappTemplateActionState,
  formData: FormData
): Promise<WhatsappTemplateActionState> {
  const t = await getAppDict()
  const gate = await authorizeWhatsappTemplateWrite(t)
  if (!gate.ok) return gate.state

  const templateId = readField(formData, "templateId")
  if (!templateId) return { error: t.templates.errors.invalid_request }

  // La categoría es opcional al editar y omitirla es «dejala como está», que es
  // lo que quiere casi todo el mundo: el formulario manda la cadena vacía y acá
  // se convierte en ausencia.
  const category = readField(formData, "category")
  const edit = parseWhatsappTemplateEdit({
    pageId: readField(formData, "pageId"),
    ...(category ? { category } : {}),
    components: buildWhatsappTemplateComponents({
      body: readField(formData, "body"),
      footer: readField(formData, "footer"),
      examples: formData.getAll("example").map(readEntry),
    }),
  })

  if (!edit.ok) return toActionError(edit, t)

  const updated = await updateWhatsappTemplateForTenant({
    tenantId: gate.tenantId,
    templateId,
    ...edit.value,
  })

  if (!updated.ok) return toActionError(updated, t)

  revalidatePath("/templates")

  return { message: t.templates.updated }
}

/**
 * Borra una plantilla propia, **sólo en el idioma elegido**.
 *
 * El borrado va por `hsm_id` y eso lo garantiza `template-admin.ts`: el borrado
 * por nombre —el que se lleva todas las versiones de idioma y quema el nombre 30
 * días— no existe en este producto. Lo que pone la pantalla es que el usuario lo
 * sepa antes de confirmar.
 */
export async function deleteWhatsappTemplateAction(
  _state: WhatsappTemplateActionState,
  formData: FormData
): Promise<WhatsappTemplateActionState> {
  const t = await getAppDict()
  const gate = await authorizeWhatsappTemplateWrite(t)
  if (!gate.ok) return gate.state

  const pageId = readField(formData, "pageId")
  const templateId = readField(formData, "templateId")
  if (!pageId || !templateId) {
    return { error: t.templates.errors.invalid_request }
  }

  const deleted = await deleteWhatsappTemplateForTenant({
    tenantId: gate.tenantId,
    pageId,
    templateId,
  })

  if (!deleted.ok) return toActionError(deleted, t)

  revalidatePath("/templates")

  return {
    message: fmt(t.templates.removed, {
      name: deleted.name,
      language: deleted.language,
    }),
  }
}

// Un rechazo del dominio, ya en el idioma del usuario. El código es lo estable y
// lo que se traduce; el texto de Meta sólo acompaña cuando nuestra traducción no
// puede decir qué arreglar.
function toActionError(
  failure: { error: string; message: string },
  t: Awaited<ReturnType<typeof getAppDict>>
): WhatsappTemplateActionState {
  const described = describeWhatsappTemplateFailure(failure)

  return {
    error: t.templates.errors[described.key],
    ...(described.detail ? { detail: described.detail } : {}),
  }
}

// `FormData` entrega `string | File`, y un `File` acá es un formulario que no es
// el nuestro: se lee como cadena vacía y lo rechaza el parser, en vez de llegar
// a Meta como `"[object File]"`.
function readField(formData: FormData, name: string): string {
  return readEntry(formData.get(name))
}

function readEntry(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : ""
}

import { beforeEach, describe, expect, it, vi } from "vitest"

// **El gate de escritura de la consola, fijado acá y no en la pantalla.**
//
// El módulo se testea entero, `"use server"` incluido: la directiva es una
// marca para el bundler de Next y no impide importarlo en Vitest, igual que en
// `features/connections/actions.test.ts` y `features/connect-meta/`. Por eso no
// hizo falta extraer la secuencia a `lib/`: sacarla de acá habría dejado el
// archivo que de verdad se invoca —el que expone los ids de acción al
// navegador— sin ninguna prueba de que llama al gate.
//
// Lo que estas pruebas fijan es lo que la revisión encontró que faltaba: una
// cuenta **sin suscripción activa** no crea, no edita y no borra desde la
// consola. Las tres se comprueban por separado a propósito: son tres endpoints
// distintos, y el fallo de la revisión fue precisamente que las tres estaban
// abiertas a la vez.

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cookieGet: vi.fn(),
  revalidatePath: vi.fn(),
  resolveWhatsappAccess: vi.fn(),
  isUserWaitlisted: vi.fn(),
  hasActiveSubscription: vi.fn(),
  createWhatsappTemplateForTenant: vi.fn(),
  updateWhatsappTemplateForTenant: vi.fn(),
  deleteWhatsappTemplateForTenant: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

// El idioma de la acción sale de la cookie `lang`. Sin store —lo que devuelve
// este mock por defecto— cae en español, que es el idioma de las aserciones.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}))

vi.mock("@/auth", () => ({
  auth: mocks.auth,
}))

vi.mock("@/lib/auth/channel-access", () => ({
  resolveWhatsappAccess: mocks.resolveWhatsappAccess,
}))

vi.mock("@/lib/auth/waitlist", () => ({
  isUserWaitlisted: mocks.isUserWaitlisted,
}))

vi.mock("@/lib/billing/subscription", () => ({
  hasActiveSubscription: mocks.hasActiveSubscription,
}))

// Sólo las tres operaciones que hablan con Graph y con la base: los dos parsers
// (`parseWhatsappTemplateDraft`, `parseWhatsappTemplateEdit`) se dejan reales
// para que el formulario de las pruebas tenga que ser uno que la API pública
// también aceptaría. Un doble del parser convertiría estas pruebas en un test
// de sus propios mocks.
vi.mock("@/lib/whatsapp-templates/template-admin", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/whatsapp-templates/template-admin")
    >()

  return {
    ...actual,
    createWhatsappTemplateForTenant: mocks.createWhatsappTemplateForTenant,
    updateWhatsappTemplateForTenant: mocks.updateWhatsappTemplateForTenant,
    deleteWhatsappTemplateForTenant: mocks.deleteWhatsappTemplateForTenant,
  }
})

import { es } from "@/content/i18n/app/es"

import {
  createWhatsappTemplateAction,
  deleteWhatsappTemplateAction,
  updateWhatsappTemplateAction,
} from "./actions"

// Un formulario válido por acción, para que lo único que pueda hacer fallar la
// llamada sea el gate.
function createForm(): FormData {
  const formData = new FormData()
  formData.set("pageId", "phone-1")
  formData.set("name", "pedido_listo")
  formData.set("language", "es")
  formData.set("category", "utility")
  formData.set("body", "Tu pedido está listo.")
  return formData
}

function updateForm(): FormData {
  const formData = new FormData()
  formData.set("pageId", "phone-1")
  formData.set("templateId", "template-1")
  formData.set("body", "Tu pedido ya salió.")
  return formData
}

function deleteForm(): FormData {
  const formData = new FormData()
  formData.set("pageId", "phone-1")
  formData.set("templateId", "template-1")
  return formData
}

// Las tres escrituras, con el doble de dominio que a cada una le toca. El gate
// es el mismo, así que la tabla evita escribir tres veces la misma prueba y
// —más importante— hace que agregar una cuarta escritura sin gate se note.
const WRITES = [
  {
    name: "createWhatsappTemplateAction",
    run: (formData: FormData) => createWhatsappTemplateAction({}, formData),
    form: createForm,
    domain: mocks.createWhatsappTemplateForTenant,
  },
  {
    name: "updateWhatsappTemplateAction",
    run: (formData: FormData) => updateWhatsappTemplateAction({}, formData),
    form: updateForm,
    domain: mocks.updateWhatsappTemplateForTenant,
  },
  {
    name: "deleteWhatsappTemplateAction",
    run: (formData: FormData) => deleteWhatsappTemplateAction({}, formData),
    form: deleteForm,
    domain: mocks.deleteWhatsappTemplateForTenant,
  },
] as const

describe("gates de escritura de plantillas", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    // Por defecto, una cuenta que puede: cada prueba cierra sólo la puerta que
    // le interesa.
    mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.resolveWhatsappAccess.mockResolvedValue(true)
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(true)
  })

  for (const write of WRITES) {
    describe(write.name, () => {
      // **El hallazgo bloqueante de la revisión del #79.** Crear una plantilla
      // deja efectos permanentes en la WABA del cliente —el nombre queda tomado
      // 30 días— y eso no puede quedar disponible para una cuenta que dejó de
      // pagar y conserva la sesión abierta.
      it("rechaza a una cuenta sin suscripción activa, sin tocar la WABA", async () => {
        mocks.hasActiveSubscription.mockResolvedValue(false)

        await expect(write.run(write.form())).resolves.toEqual({
          error: es.actions.noSubscription,
        })

        expect(write.domain).not.toHaveBeenCalled()
        expect(mocks.revalidatePath).not.toHaveBeenCalled()
      })

      it("rechaza sin sesión", async () => {
        mocks.auth.mockResolvedValue(null)

        await expect(write.run(write.form())).resolves.toEqual({
          error: es.actions.notSignedIn,
        })

        expect(write.domain).not.toHaveBeenCalled()
      })

      // Quitarle el permiso de WhatsApp a una cuenta tiene que cerrar todas las
      // puertas del canal, no sólo la de conectar un número.
      it("rechaza con el canal de WhatsApp deshabilitado", async () => {
        mocks.resolveWhatsappAccess.mockResolvedValue(false)

        await expect(write.run(write.form())).resolves.toEqual({
          error: es.actions.whatsappNotEnabled,
        })

        expect(write.domain).not.toHaveBeenCalled()
      })

      it("rechaza a una cuenta en la lista de espera", async () => {
        mocks.isUserWaitlisted.mockResolvedValue(true)

        await expect(write.run(write.form())).resolves.toEqual({
          error: es.actions.waitlisted,
        })

        expect(write.domain).not.toHaveBeenCalled()
      })

      // El orden importa para lo que ve el usuario: a un moroso se le dice que
      // su suscripción no está activa, no que le falta un campo. Enterarse de
      // que no puede pagar **después** de corregir el formulario tres veces es
      // la versión lenta del mismo "no".
      it("contesta el gate antes que la validación del formulario", async () => {
        mocks.hasActiveSubscription.mockResolvedValue(false)

        await expect(write.run(new FormData())).resolves.toEqual({
          error: es.actions.noSubscription,
        })

        expect(write.domain).not.toHaveBeenCalled()
      })
    })
  }
})

// Con los cuatro permisos abiertos la acción sí llega al dominio, y llega con
// el tenant de la sesión. Sin esto, un gate que rechazara siempre pasaría todas
// las pruebas de arriba.
describe("con los permisos abiertos", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.cookieGet.mockReturnValue(undefined)
    mocks.auth.mockResolvedValue({ user: { id: "tenant-1" } })
    mocks.resolveWhatsappAccess.mockResolvedValue(true)
    mocks.isUserWaitlisted.mockResolvedValue(false)
    mocks.hasActiveSubscription.mockResolvedValue(true)
  })

  it("crea la plantilla con el tenant de la sesión", async () => {
    mocks.createWhatsappTemplateForTenant.mockResolvedValue({
      ok: true,
      mirrored: true,
      template: { name: "pedido_listo" },
    })

    await expect(
      createWhatsappTemplateAction({}, createForm())
    ).resolves.toEqual({
      message:
        "«pedido_listo» se creó y está en revisión. WhatsApp suele tardar hasta 24 horas.",
    })

    expect(mocks.createWhatsappTemplateForTenant).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", pageId: "phone-1" })
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates")
  })

  it("borra la plantilla con el tenant de la sesión", async () => {
    mocks.deleteWhatsappTemplateForTenant.mockResolvedValue({
      ok: true,
      id: "template-1",
      name: "pedido_listo",
      language: "es",
    })

    await expect(
      deleteWhatsappTemplateAction({}, deleteForm())
    ).resolves.toEqual({
      message: "«pedido_listo» (es) se borró.",
    })

    expect(mocks.deleteWhatsappTemplateForTenant).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      pageId: "phone-1",
      templateId: "template-1",
    })
  })

  it("edita la plantilla con el tenant de la sesión", async () => {
    mocks.updateWhatsappTemplateForTenant.mockResolvedValue({
      ok: true,
      returnsToReview: true,
      message: "ok",
      template: { name: "pedido_listo" },
    })

    await expect(
      updateWhatsappTemplateAction({}, updateForm())
    ).resolves.toEqual({ message: es.templates.updated })

    expect(mocks.updateWhatsappTemplateForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        templateId: "template-1",
        pageId: "phone-1",
      })
    )
  })
})

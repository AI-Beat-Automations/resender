"use server"

import { getDictionary, type Locale } from "@/content/i18n"
import { posthog } from "@/lib/posthog"
import { allowWaitlistSignup } from "@/lib/waitlist/rate-limit"
import { createWaitlistSignup } from "@/lib/waitlist/repository"
import {
  CONSENT_VERSION,
  isHoneypotFilled,
  normalizeWaitlistSource,
  validateWaitlistInput,
} from "@/lib/waitlist/validation"

export type WaitlistFormState = {
  error?: string
  success?: boolean
}

// El idioma llega en un input oculto del form, igual que en
// `features/auth/actions.ts`: un server action no ve el pathname de la página
// que lo invocó, y esta acción la comparten `/` y `/en` (landing) con
// `/waitlist` y `/en/waitlist`.
function localeOf(formData: FormData): Locale {
  return formData.get("locale") === "en" ? "en" : "es"
}

// Alta en la lista de espera pública (ADR 0007). Es la primera escritura
// anónima del repo —todo lo demás pasa por sesión, API key o firma HMAC—, así
// que el orden de las capas no es casual: primero lo que descarta tráfico sin
// tocar nada, después lo que cuesta una consulta.
export async function joinWaitlistAction(
  _state: WaitlistFormState,
  formData: FormData
): Promise<WaitlistFormState> {
  const t = getDictionary(localeOf(formData)).waitlist.errors

  // 1) Campo trampa. Va primero porque es gratis: si vino con contenido es un
  // bot que completó todos los inputs, incluido el que está oculto por CSS. Se
  // devuelve el mismo éxito que vería una persona, sin gastar el rate limit ni
  // llamar al repositorio: un error delataría la trampa y el bot la esquivaría
  // en el siguiente intento.
  if (isHoneypotFilled(formData.get("nickname2"))) return { success: true }

  // 2) Rate limit por IP (tercera capa de protección de la ADR, junto al
  // honeypot y al unique index). Va antes de validar para que el coste de un
  // ataque no dependa de mandar formularios bien formados.
  if (!(await allowWaitlistSignup())) return { error: t.rateLimited }

  // 3) Validación. El validador devuelve claves de error, no mensajes: esta es
  // una superficie bilingüe y el texto lo resuelve el diccionario acá (ADR
  // 0006), en el idioma que declaró la página.
  const input = validateWaitlistInput({
    email: formData.get("email"),
    heardFrom: formData.get("heardFrom"),
    heardFromOther: formData.get("heardFromOther"),
    consent: formData.get("consent"),
  })
  if (!input.ok) return { error: t[input.error] }

  // El `source` viaja en un campo oculto y cualquiera puede editarlo, así que
  // lo decide el servidor desde el conjunto cerrado de la ADR: un valor
  // desconocido cae en "landing" en vez de guardarse crudo y romper el
  // `group by` del día del anuncio.
  const source = normalizeWaitlistSource(formData.get("source"))

  // 4) Inserción. `consent_version` se guarda con el alta para saber qué
  // redacción del aviso aceptó cada persona el día que el texto cambie, sin
  // arqueología de commits.
  let result
  try {
    result = await createWaitlistSignup({
      email: input.value.email,
      source,
      heardFrom: input.value.heardFrom,
      heardFromOther: input.value.heardFromOther,
      consentVersion: CONSENT_VERSION,
    })
  } catch (error) {
    // Un fallo de base no puede terminar en un stack ni en una pantalla rota:
    // del otro lado hay alguien de pie en un evento. Se registra para nosotros
    // y se devuelve el genérico del diccionario (mismo criterio que
    // `features/connections/actions.ts`). El correo NO se loguea: es un dato
    // personal de alguien que ni siquiera es cliente.
    console.error("waitlist signup failed", source, error)
    return { error: t.unexpected }
  }

  if (posthog) {
    try {
      posthog.capture({
        // El `distinctId` es el origen, NO el correo. En el resto del repo es
        // un id de tenant, pero acá del otro lado hay alguien que no es cliente
        // y cuyo consentimiento cubre que le escribamos, no que su correo salga
        // hacia analítica: la lista vive en Postgres y en ningún otro lado
        // (ADR 0007), y `/privacy` promete justamente eso.
        distinctId: `waitlist:${source}`,
        event: "waitlist signup",
        properties: {
          source,
          heard_from: input.value.heardFrom,
          // `created: false` es el correo repetido. La persona no lo ve, pero
          // sin esta propiedad el embudo contaría dos altas donde hubo una.
          created: result.created,
        },
      })
      // El Worker puede terminar el request antes de que el cliente vacíe la
      // cola, así que el flush se espera.
      await posthog.flush()
    } catch (error) {
      // La fila ya está guardada: que la analítica falle no puede convertir un
      // alta exitosa en un error para quien está de pie en un evento.
      console.error("waitlist signup analytics failed", error)
    }
  }

  // Alta nueva y correo repetido devuelven exactamente lo mismo: el éxito es
  // idempotente (ADR 0007) y una respuesta distinta permitiría averiguar si un
  // correo ajeno está en la lista.
  return { success: true }
}

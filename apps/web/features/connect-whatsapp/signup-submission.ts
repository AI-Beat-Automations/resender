import type { WhatsappSignupAssets } from "./signup-events"

// Cuándo se puede enviar el cierre del Embedded Signup, y qué falta cuando no.
//
// **Por qué es un módulo puro y no tres `if` dentro del launcher.** El repo no
// tiene tests de componentes —vitest corre en node, sin jsdom—, y esta decisión
// tiene una rama que solo se puede razonar leyéndola: el envío necesita **tres**
// cosas y solo dos llegan por los canales del popup. La tercera es el nonce, que
// el launcher renueva por su cuenta cada ocho minutos y también después de cada
// intento, y durante esa renovación **no hay nonce en memoria** (se retira antes
// de pedir el siguiente a propósito, para no armar el botón con uno que la
// cookie ya reemplazó).
//
// Si la pareja `code` + assets se completa justo dentro de esa ventana, el
// formulario salía con `nonce: ""` y el servidor lo rechazaba con un
// `state_mismatch` —después de que el usuario hiciera el onboarding entero, y
// con un `code` de 30 segundos ya gastado—. La ventana es corta, pero el precio
// de caerse en ella es el máximo posible del flujo, así que la decisión es
// esperar: el envío queda pendiente y lo dispara la renovación al terminar, que
// tarda lo que tarda una server action y entra de sobra en los 30 segundos.
export type WhatsappSubmissionInput = {
  // El `code` del callback de `FB.login`.
  code: string | null
  // Los identificadores del `postMessage`.
  assets: WhatsappSignupAssets | null
  // El nonce vigente en memoria. `null` mientras se está renovando.
  nonce: string | null
}

export type WhatsappSubmissionDecision =
  | {
      kind: "submit"
      code: string
      assets: WhatsappSignupAssets
      nonce: string
    }
  // Falta uno de los dos canales del popup. `started` es `true` cuando ya llegó
  // el otro: es lo que arranca el reloj de la espera, porque a partir de ahí un
  // silencio significa que la autorización volvió a medias.
  | { kind: "await-pairing"; started: boolean }
  // Están los dos, falta el nonce. No es un error y no se le cuenta al usuario:
  // se envía solo en cuanto la renovación aterrice.
  | { kind: "await-nonce" }

export function decideWhatsappSubmission(
  input: WhatsappSubmissionInput
): WhatsappSubmissionDecision {
  const { code, assets, nonce } = input

  if (!code || !assets) {
    return { kind: "await-pairing", started: Boolean(code || assets) }
  }

  if (!nonce) return { kind: "await-nonce" }

  return { kind: "submit", code, assets, nonce }
}

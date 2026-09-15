import crypto from "crypto"

// Verificación de la firma de Meta, extraída de las dos rutas de webhook por
// dos razones.
//
// La primera es que es pura y se puede testear: hasta ahora la comparación
// vivía adentro de un route handler que ningún test toca, y es la pieza de la
// que depende que un evento entre o se rechace.
//
// La segunda es que devuelve **cuál** de las dos cosas falló. «No llegó firma»
// y «la firma no coincide» se investigan distinto: la primera es Meta pegándole
// a la ruta equivocada o un cliente que no es Meta, y la segunda es el App
// Secret cambiado —que es exactamente el incidente en el que la ruta rechazaba
// todo con 401 sin registrar nada, y el síntoma se veía igual que «no llega
// nada»—.

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "missing_signature" | "signature_mismatch" }

export function verifyMetaSignature(input: {
  // El body **crudo**, tal cual llegó. Reserializar el JSON cambia el orden o
  // el espaciado y la firma deja de coincidir.
  raw: string
  header: string | null
  appSecret: string
}): SignatureCheck {
  if (!input.header) return { ok: false, reason: "missing_signature" }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", input.appSecret).update(input.raw).digest("hex")

  return safeEqual(input.header, expected)
    ? { ok: true }
    : { ok: false, reason: "signature_mismatch" }
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  // `timingSafeEqual` tira si los largos difieren, así que el chequeo va antes.
  // No filtra nada útil: el largo de la firma esperada es público.
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

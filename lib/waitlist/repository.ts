import { getSql } from "@/lib/db"

import type { HeardFrom, WaitlistSource } from "./validation"

export type WaitlistSignupResult = { created: boolean }

type WaitlistSignupRow = {
  id: string
}

export async function createWaitlistSignup(input: {
  email: string
  source: WaitlistSource
  heardFrom: HeardFrom
  heardFromOther: string | null
  consentVersion: string
}): Promise<WaitlistSignupResult> {
  const sql = getSql()

  // `on conflict do nothing` en vez de dejar reventar el unique: un correo
  // repetido es un **éxito idempotente** (ADR 0007). La persona ve el mismo
  // mensaje que la primera vez, así que nadie puede averiguar si un correo
  // ajeno está en la lista, y al no actualizar nada la atribución del primer
  // registro queda intacta (first-touch): un segundo envío no pisa `source` ni
  // `heard_from`.
  //
  // El conflict target es la expresión `lower(email)` porque el unique index es
  // sobre esa expresión, no sobre la columna.
  //
  // `consent_at` se escribe con `now()` del servidor: la hora del cliente no es
  // prueba de nada.
  const rows = await sql<WaitlistSignupRow[]>`
    insert into waitlist_signups (
      email,
      source,
      heard_from,
      heard_from_other,
      consent_at,
      consent_version
    )
    values (
      ${input.email},
      ${input.source},
      ${input.heardFrom},
      ${input.heardFromOther},
      now(),
      ${input.consentVersion}
    )
    on conflict (lower(email)) do nothing
    returning id
  `

  // Sin fila devuelta hubo conflicto: el correo ya estaba anotado.
  return { created: rows.length > 0 }
}

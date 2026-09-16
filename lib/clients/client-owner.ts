import { getSql } from "@/lib/db"

// El [Padre] visto desde el cliente (issue #154): cómo se lo nombra en la
// pantalla de aceptación, en la nota de Ajustes y en la cuenta restringida.
// Nunca su id ni nada de facturación: solo cómo se presenta.

export type ClientOwner = { name: string; email: string }

/** Función pura: el padre se presenta por su nombre, o por su correo si no tiene. */
export function ownerDisplayName(owner: ClientOwner): string {
  return owner.name.trim() || owner.email
}

export async function getClientOwner(
  tenantId: string
): Promise<ClientOwner | null> {
  const sql = getSql()
  const [row] = await sql<ClientOwner[]>`
    select name, email
    from users
    where id = ${tenantId}
    limit 1
  `
  return row ?? null
}

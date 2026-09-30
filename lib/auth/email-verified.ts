import { getSql } from "@/lib/db"

// [Verificacion de correo] leída **viva**, con la misma forma que
// `resolveProductAccess` (`lib/auth/waitlist.ts`). La librería trae
// `emailVerified` en `session.user`, pero la sesión viaja en una cookie de
// caché que vive hasta cinco minutos: tras confirmar el correo, `/pending`
// seguiría diciendo «sin confirmar» si leyera de ahí. Es la misma doctrina que
// rige para `waitlisted`: las banderas que cambian por fuera del login se leen
// contra la base en cada request.
//
// Lo consumen `/pending` (dibujar o no el bloque de confirmación) y el panel
// «Cómo entras a Resender» de Settings (fila de estado y habilitar «Vincular»).
export type EmailVerifiedRow = { email_verified: boolean }

type MaybeRow = EmailVerifiedRow | null | undefined

// Fail closed: sin fila (cuenta borrada con sesión viva) o con la bandera
// ilegible se responde «no confirmado». Un falso «confirmado» habilitaría el
// botón de vincular Google a una cuenta que la librería igual va a rechazar,
// y ese rebote es peor que un botón deshabilitado.
export function decideEmailVerified(row: MaybeRow): boolean {
  return row?.email_verified === true
}

export async function isEmailVerified(userId: string): Promise<boolean> {
  const sql = getSql()
  const [row] = await sql<EmailVerifiedRow[]>`
    select email_verified
    from users
    where id = ${userId}
    limit 1
  `

  return decideEmailVerified(row)
}

// A dónde aterriza el [Enlace de verificacion] (el `callbackURL` del alta y
// del reenvío). Desde que la verificación ya no bloquea la entrada, es el
// producto y no `/pending`: `verify=1` es la marca para la franja verde de
// «confirmado», y si el enlace no sirve la librería le agrega `&error=…`, que
// la barra de verificación lee.
export const VERIFY_EMAIL_CALLBACK_URL = "/connections?verify=1"

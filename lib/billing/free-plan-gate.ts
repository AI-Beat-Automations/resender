import { isEmailVerified } from "@/lib/auth/email-verified"

import { hasActiveSubscription } from "./subscription"

// Gate de correo del plan Free (ADR 0022). Registrarse ya da el plan Free,
// pero usarlo exige el correo confirmado. Una suscripción de pago `active` lo
// salta: esas cuentas entraron cuando no se pedía confirmación, y cerrarles
// el producto a quien paga sería el costo equivocado de la regla.
//
// Recibe el `userId` del dueño, que es también su `tenantId`. Se lee vivo,
// igual que la lista de espera; la suscripción solo se consulta si el correo
// no está confirmado, que es el caso raro.
export async function needsEmailVerification(userId: string): Promise<boolean> {
  if (await isEmailVerified(userId)) return false
  return !(await hasActiveSubscription(userId))
}

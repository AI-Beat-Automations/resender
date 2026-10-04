import { posthog } from "@/lib/posthog"

export type SignupMethod = "email" | "google"

// `user registered` sale de **un solo lugar por camino de alta**: el hook
// `user.create.after` de Better Auth (correo y Google) y la aceptación de una
// [Invitacion de cliente], que inserta el user a mano y no pasa por la
// librería. Antes vivía en `registerAction` y el alta con Google no lo
// disparaba nunca.
//
// Además deja la persona con todas las propiedades que los dashboards separan
// por plan, para que un usuario nuevo no aparezca «sin plan» hasta su primer
// pago.
export async function captureUserRegistered(input: {
  userId: string
  email: string
  method: SignupMethod
  isInvitedClient: boolean
}): Promise<void> {
  if (!posthog) return
  posthog.capture({
    distinctId: input.userId,
    event: "user registered",
    properties: {
      signup_method: input.method,
      plan: "free",
      // No hay cupones en el alta: se canjean en el Checkout de Stripe
      // (`coupon redeemed`). Va explícito para que la propiedad exista.
      coupon_code: null,
      is_invited_client: input.isInvitedClient,
      $set: {
        email: input.email,
        plan: "free",
        subscription_status: "none",
        mrr: 0,
        connections_count: 0,
      },
      $set_once: { signed_up_at: new Date().toISOString() },
    },
  })
  await posthog.flush()
}

// El camino de alta según el endpoint de Better Auth que creó la fila:
// `/sign-up/email` o el callback de OAuth (`/callback/:id`, con el proveedor en
// `params.id`). Hoy el único proveedor social es Google.
export function signupMethodOf(
  ctx:
    | { path?: string; params?: Record<string, string | undefined> }
    | null
    | undefined
): SignupMethod {
  if (ctx?.path?.startsWith("/callback") && ctx.params?.id === "google") {
    return "google"
  }
  return "email"
}

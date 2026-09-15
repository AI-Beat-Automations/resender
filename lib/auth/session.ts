import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { getAuth } from "@/lib/auth/auth"

// **El único lugar del repositorio que le habla a Better Auth para leer o
// cerrar la sesión.** Los 25 consumidores —el layout de `(product)`, las
// pantallas de acceso, las rutas de los tres canales y los server actions—
// importan de acá y no de la librería: la autoridad de sesión se sustituye
// dentro de este archivo, y este archivo es también el punto de mockeo de los
// tests.
//
// La forma que devuelve es deliberadamente la que ya consumían los call sites
// (`session?.user?.id`, `session.user.email`): si algún día hay que cambiarla,
// el cambio se ve acá y no repartido en 25 archivos.

export type AppSession = {
  user: {
    id: string
    email: string
    /** Puede ser `""`: las cuentas anteriores al alta con nombre. */
    name: string
  }
}

export async function getSession(options?: {
  /**
   * Saltea la cookie de caché y resuelve contra `auth_sessions`. Cuesta un
   * round-trip HTTP a Neon, así que es para el camino que necesita saber si la
   * fila **sigue viva ahora** —revocación—, no para el hot path del producto.
   */
  fresh?: boolean
}): Promise<AppSession | null> {
  const result = await getAuth().api.getSession({
    headers: await headers(),
    ...(options?.fresh ? { query: { disableCookieCache: true } } : {}),
  })

  const user = result?.user
  if (!user?.id) return null

  return {
    user: { id: user.id, email: user.email, name: user.name ?? "" },
  }
}

/**
 * Cierra la sesión y redirige. A diferencia del JWT de Auth.js, esto **borra la
 * fila de `auth_sessions`** además de la cookie: la sesión deja de existir del
 * lado del servidor, no solo del navegador.
 *
 * Lanza el redirect de Next, así que nunca retorna.
 */
export async function signOut(options?: {
  redirectTo?: string
}): Promise<never> {
  await getAuth().api.signOut({ headers: await headers() })
  redirect(options?.redirectTo ?? "/")
}

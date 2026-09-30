import { cache } from "react"

import { resolveChannelAccess } from "@/lib/auth/channel-access"
import { needsEmailVerification } from "@/lib/billing/free-plan-gate"
import { listTenantPages } from "@/lib/pages/page-registry"

// Las mismas lecturas las hacen el header (slot `@header`) y la página de
// Conexiones en la misma petición. `cache` las deduplica por argumentos dentro
// del render, sin tocar `lib/`.
export const listTenantPagesCached = cache(listTenantPages)
export const resolveChannelAccessCached = cache(resolveChannelAccess)
// Free sin correo confirmado: el connect gate le cierra las redes, así que el
// header y la página dibujan los «Conectar…» deshabilitados.
export const needsEmailVerificationCached = cache(needsEmailVerification)

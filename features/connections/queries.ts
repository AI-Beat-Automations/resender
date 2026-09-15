import { cache } from "react"

import { resolveChannelAccess } from "@/lib/auth/channel-access"
import { listTenantPages } from "@/lib/pages/page-registry"

// Las mismas lecturas las hacen el header (slot `@header`) y la página de
// Conexiones en la misma petición. `cache` las deduplica por argumentos dentro
// del render, sin tocar `lib/`.
export const listTenantPagesCached = cache(listTenantPages)
export const resolveChannelAccessCached = cache(resolveChannelAccess)

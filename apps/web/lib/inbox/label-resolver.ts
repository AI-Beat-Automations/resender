import {
  fetchInstagramContactProfile,
  fetchInstagramMedia,
} from "@/lib/instagram"
import { getActivePageWithTokenByConnectionId } from "@/lib/pages/page-registry"

import {
  listCachedMedia,
  saveContactProfile,
  saveMedia,
  type MediaCacheRow,
} from "./label-cache"

// Resuelve las etiquetas que Meta no manda en el webhook: el @handle de quien
// escribió y el permalink de la publicación comentada.
//
// Corre al **leer la pantalla**, no al ingerir el webhook. Es la decisión que
// hace que las filas viejas se completen solas la primera vez que alguien las
// mira —que es cuando importan— en vez de quedar mudas para siempre mientras el
// backfill espera a que alguien lo corra. El precio es una llamada a Graph en el
// render, y por eso todo lo de acá falla hacia el lado seguro: un error deja la
// etiqueta como estaba y no rompe la pantalla.

// Un fallo se recuerda un día. Sin esto, una publicación borrada se volvería a
// pedir a Graph en cada render, para siempre, y siempre con el mismo resultado.
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000

// Techo de llamadas por render. El log no tiene paginación, así que un tenant
// con cien conversaciones pediría cien perfiles la primera vez. Se resuelven las
// más recientes —que son las de arriba— y el resto cae en la siguiente visita.
const MAX_LOOKUPS_PER_RENDER = 20

export type ResolvableContact = {
  conversationId: string
  connectedPageId: string
  channel: string
  contactId: string
  contactUsername: string | null
  contactSyncedAt: Date | null
}

export type ResolvedContact = {
  username: string | null
  name: string | null
}

export type ResolvablePublication = {
  connectedPageId: string
  mediaId: string
}

export type ResolvedMedia = {
  permalink: string | null
  caption: string | null
}

/**
 * Devuelve `conversationId -> perfil` para las conversaciones que hubo que
 * resolver. Lo ya cacheado no vuelve en el mapa: el llamador lo tiene en la
 * propia fila.
 */
export async function resolveContactProfiles(
  tenantId: string,
  contacts: ResolvableContact[]
): Promise<Map<string, ResolvedContact>> {
  const resolved = new Map<string, ResolvedContact>()
  const pending = contacts
    .filter(
      (contact) =>
        // Messenger queda fuera: sus perfiles piden `pages_user_profile`, que
        // no está en el `config_id` del login, y el PSID sigue siendo lo único
        // que identifica al contacto.
        contact.channel === "instagram" &&
        !contact.contactUsername &&
        isStale(contact.contactSyncedAt)
    )
    .slice(0, MAX_LOOKUPS_PER_RENDER)

  if (pending.length === 0) return resolved

  const tokens = await loadTokens(
    tenantId,
    pending.map((contact) => contact.connectedPageId)
  )

  await Promise.all(
    pending.map(async (contact) => {
      const token = tokens.get(contact.connectedPageId)
      if (!token) return

      const profile = await fetchInstagramContactProfile(
        token,
        contact.contactId
      )
      // Se persiste también el fallo (`profile === null` deja los dos campos en
      // null pero sella `contact_synced_at`), que es lo que corta el reintento.
      await saveContactProfile({
        tenantId,
        conversationId: contact.conversationId,
        username: profile?.username ?? null,
        name: profile?.name ?? null,
      })
      if (profile) resolved.set(contact.conversationId, profile)
    })
  )

  return resolved
}

/**
 * Devuelve `"<connectedPageId>:<mediaId>" -> publicación`, con lo cacheado y lo
 * recién pedido en el mismo mapa. La clave es la misma que usa `?media=`.
 */
export async function resolveMedia(
  tenantId: string,
  publications: ResolvablePublication[]
): Promise<Map<string, ResolvedMedia>> {
  const resolved = new Map<string, ResolvedMedia>()
  if (publications.length === 0) return resolved

  const byPage = new Map<string, string[]>()
  for (const publication of publications) {
    const list = byPage.get(publication.connectedPageId) ?? []
    list.push(publication.mediaId)
    byPage.set(publication.connectedPageId, list)
  }

  const cached: MediaCacheRow[] = (
    await Promise.all(
      [...byPage].map(([connectedPageId, mediaIds]) =>
        listCachedMedia({ connectedPageId, mediaIds })
      )
    )
  ).flat()

  const cachedByKey = new Map(
    cached.map((row) => [mediaKey(row.connectedPageId, row.mediaId), row])
  )
  for (const row of cached) {
    if (row.permalink || row.caption) {
      resolved.set(mediaKey(row.connectedPageId, row.mediaId), {
        permalink: row.permalink,
        caption: row.caption,
      })
    }
  }

  const pending = publications
    .filter((publication) => {
      const row = cachedByKey.get(
        mediaKey(publication.connectedPageId, publication.mediaId)
      )
      if (!row) return true
      return !row.permalink && isStale(row.syncedAt)
    })
    .slice(0, MAX_LOOKUPS_PER_RENDER)

  if (pending.length === 0) return resolved

  const tokens = await loadTokens(
    tenantId,
    pending.map((publication) => publication.connectedPageId)
  )

  await Promise.all(
    pending.map(async (publication) => {
      const token = tokens.get(publication.connectedPageId)
      if (!token) return

      const media = await fetchInstagramMedia(token, publication.mediaId)
      await saveMedia({
        connectedPageId: publication.connectedPageId,
        mediaId: publication.mediaId,
        permalink: media?.permalink ?? null,
        caption: media?.caption ?? null,
        mediaProductType: media?.mediaProductType ?? null,
      })
      if (media) {
        resolved.set(
          mediaKey(publication.connectedPageId, publication.mediaId),
          { permalink: media.permalink, caption: media.caption }
        )
      }
    })
  )

  return resolved
}

export function mediaKey(connectedPageId: string, mediaId: string) {
  return `${connectedPageId}:${mediaId}`
}

function isStale(syncedAt: Date | null) {
  if (!syncedAt) return true
  return Date.now() - syncedAt.getTime() > RETRY_AFTER_MS
}

// Un token por cuenta, no por fila: un log filtrado por cuenta hace una sola
// lectura, y uno sin filtrar hace tantas como cuentas conectadas tenga.
async function loadTokens(tenantId: string, connectedPageIds: string[]) {
  const unique = [...new Set(connectedPageIds)]
  const entries = await Promise.all(
    unique.map(async (connectedPageId) => {
      const resolved = await getActivePageWithTokenByConnectionId(
        tenantId,
        connectedPageId
      )
      return [connectedPageId, resolved?.pageAccessToken ?? null] as const
    })
  )

  return new Map(
    entries.filter((entry): entry is [string, string] => entry[1] !== null)
  )
}

// Coerciones sobre JSON no confiable, compartidas por los cinco parsers.
//
// Regla transversal, heredada de los otros canales: **nunca lanzan**. Lo que no
// tiene la forma esperada vuelve como null y el que llama decide si eso es
// motivo para descartar el elemento o solo para dejar un campo vacío.

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

// Arma el jsonb de `attachment_meta` tirando lo que no vino. La ausencia de una
// clave es información —«este payload no lo dice»— y es distinta de un null
// explícito, que se leería como «Meta lo mandó vacío». `false` sí se conserva:
// en `voice` significa «es un fichero de audio», no «no consta».
export function compact(
  details: Record<string, unknown>
): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined) continue
    clean[key] = value
  }
  return clean
}

// Quita recursivamente cualquier `url` de string de lo que se vaya a persistir
// en `attachment_meta`. La única URL que Meta mete en estos payloads es la de
// descarga de media —directa en el propio mensaje desde noviembre de 2025, y
// anidada dentro de `edit.message.<type>` en los echoes—, y caduca a los cinco
// minutos. El barrido es a ciegas y por eso se lleva por delante alguna URL
// inofensiva (la web de un negocio en una ubicación citada dentro de un
// `edit`), pero esa pérdida es cosmética; guardar un enlace firmado que caduca
// en cinco minutos, en cambio, es un secreto muerto en la base de datos.
export function stripMediaUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMediaUrls)

  const record = asRecord(value)
  if (!record) return value

  const clean: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    if (key === "url" && typeof item === "string") continue
    clean[key] = stripMediaUrls(item)
  }
  return clean
}

// WhatsApp manda el `timestamp` en **segundos y como string**, mientras que los
// webhooks de mensajes de Messenger e Instagram lo mandan en milisegundos y
// como número. Se distingue por magnitud, igual que en el parser de comentarios
// de Instagram: leer diez dígitos como milisegundos fecha todo en 1970 y
// desordena el hilo entero.
export function normalizeTimestamp(value: unknown): Date {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(numeric) || numeric <= 0) return new Date()

  const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

// La documentación se contradice sobre si los teléfonos llevan `+`: las tablas
// de parámetros lo ponen y los ejemplos JSON no. Comparar por dígitos es lo
// único que sobrevive a las dos formas.
export function samePhone(left: string | null, right: string | null): boolean {
  if (!left || !right) return false
  return digitsOf(left) === digitsOf(right)
}

export function digitsOf(value: string): string {
  return value.replace(/\D/g, "")
}

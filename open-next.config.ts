import { defineCloudflareConfig } from "@opennextjs/cloudflare"
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache"

// Cache incremental de solo lectura servido desde los assets estáticos: el
// worker no tiene filesystem, así que las páginas SSG (blog, landing) deben
// salir del HTML prerenderizado en build. Sin revalidación/ISR; si algún día
// se necesita, migrar a R2 (r2-incremental-cache).
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
})

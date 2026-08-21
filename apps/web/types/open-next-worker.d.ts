// El worker que genera OpenNext (`.open-next/worker.js`) es un artefacto de
// build: está en `.gitignore` y no existe hasta que corre `opennextjs-cloudflare
// build`. Pero `worker.ts` lo importa, y `tsc --noEmit` corre en CI **sin
// garantía de haber buildeado antes** (`turbo lint typecheck test:run build` no
// ordena typecheck después de build). Sin esta declaración, el typecheck falla
// en una rama limpia.
//
// El comodín matchea el especificador relativo igual que `declare module "*?raw"`
// en `apps/api/src/raw-imports.d.ts`: TypeScript cae al patrón ambiente cuando la
// resolución normal no encuentra el archivo.
//
// Solo se declara `fetch`, que es lo único que OpenNext exporta y lo único que
// `worker.ts` reexporta. Si algún día se usan el DO Queue o el Tag Cache de
// OpenNext, hay que agregar acá `DOQueueHandler` / `DOShardedTagCache` y
// reexportarlos también desde `worker.ts`, o el cache deja de funcionar en
// silencio.
declare module "*.open-next/worker.js" {
  const handler: {
    fetch(
      request: Request,
      env: CloudflareEnv,
      ctx: WorkerExecutionContext,
    ): Promise<Response>
  }
  export default handler
}

# Code patterns

## Logs: nunca interrumpen el flujo

El camino crítico (Meta → webhook → agente del tenant → Resender → Meta) no puede fallar ni frenarse por observabilidad. Perder una línea de log es aceptable; perder un mensaje no.

- **Solo `log()`** de `lib/observability/logger.ts`. Nada de `console.*` suelto ni `Sentry.*` directo: `log()` ya manda a Workers Logs y a Sentry Logs, redacta secretos y **no lanza nunca**.
- **Síncrono y sin `await`.** No esperes un log ni un `Sentry.flush()` en el camino del request o antes del ack de la cola. Un flush va en `ctx.waitUntil(...)` (ver `worker.ts`).
- **Ninguna lógica depende del log.** Dentro de un `catch`, el reintento, la DLQ o la respuesta van igual, se loguee o no. No metas cálculos que puedan lanzar en los argumentos de `log()`: usa `describeError(error)`, no `error.message` sobre algo que no sabes si es `Error`.
- **Antes del 200 a Meta, lo mínimo.** El trabajo pesado y sus logs van dentro de `after()`.
- **Literales del catálogo.** Acciones y motivos nuevos van en `lib/observability/catalog.ts`, en su `@section`. Nunca va contenido del usuario ni tokens: el tipo no los admite.

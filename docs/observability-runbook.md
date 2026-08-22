# Runbook de observabilidad

Cómo se leen los logs de los dos workers y cómo se contestan las dos preguntas
que más caro salieron: **«¿por qué no llegó nada?»** y **«¿qué pasó con la
cuenta X?»**.

Los logs son la superficie de **debugging**, no la auditoría. La retención de
Workers Logs se mide en días; el registro durable sigue siendo
`external_webhook_deliveries`, `messages` e `instagram_comments`.

---

## La regla

**Ningún camino puede terminar en silencio.** Cada descarte, cada retorno
temprano y cada rama de error emite exactamente una línea que dice qué cuenta,
qué acción y por qué.

El mecanismo no es la disciplina, es el tipo: en
`apps/web/lib/observability/logger.ts` el campo `reason` es **obligatorio**
cuando `outcome !== "ok"`, así que un descarte sin motivo no compila. Y en
`apps/web/lib/inbound/inbound-ingestion.test.ts` hay un test invariante que
exige **exactamente una** línea terminal por evento ingerido: si alguien agrega
un `continue` y se olvida del log, falla sin que nadie tenga que acordarse de
sumarle un caso.

---

## Los campos

Cada línea es **un solo objeto** a `console.log` —nunca un string interpolado ni
dos argumentos—, porque es lo que hace que Workers Logs indexe las claves y las
vuelva filtrables.

| Campo | Qué es |
|---|---|
| `worker` | `web` o `api` |
| `action` | El verbo: `webhook_receive`, `inbound_ingest`, `webhook_delivery`, `outbound_send`, `comment_reply`, `oauth_callback`… |
| `outcome` | `ok` · `dropped` · `duplicate` · `skipped` · `retry` · `failed` · `dead` |
| `reason` | Obligatorio salvo en `ok`. Unión cerrada; ver el módulo del logger |
| `event` | Derivado: `` `${action}_${outcome}` ``. Es la columna que se lee de un vistazo |
| `channel` | `messenger` o `instagram`. **Presente siempre que haya cuenta** |
| `accountId` | `connected_pages.meta_page_id`: el page id de FB o el IG ID. **El valor que se pega en el filtro** |
| `accountHandle` | El @handle. Solo Instagram |
| `connectionId` | El uuid de la fila en `connected_pages`: la clave de join a la base |
| `tenantId` | |
| `requestId` | Ata un POST de Meta con sus N eventos y sus N entregas |
| `subject` / `subjectId` | `message` o `comment`, y el uuid de la fila |
| `providerId` | El `mid` de Meta o el `ig_comment_id` |
| `textLength` | El largo. **El texto nunca se loguea** |

### Lo que nunca sale

El tipo no tiene campo para el texto de un mensaje, ni para un token, ni para
una firma, ni para el body crudo de Graph, y no hay ningún `unknown` ni
`Record<string, unknown>` por donde puedan entrar. Además, `errorMessage` pasa
por un scrubber que borra `access_token=`, `client_secret=`, `sha256=<64 hex>`,
tokens `EA…`/`IG…` y claves `pk_live_`/`sk_`, y trunca a 300 caracteres.

Tampoco se loguea el `webhookUrl` del tenant: lo controla el cliente y las URLs
de n8n suelen llevar un token en el path. `connectionId` alcanza para saber cuál
era.

---

## Las consultas

### En el panel (Workers → `web` → Observability → Logs)

Cuatro vistas para guardar:

| Pregunta | Filtro |
|---|---|
| **¿Por qué no llegó nada?** | `$.action = "webhook_receive"` |
| **¿Qué pasó con la cuenta X?** | `$.accountId = "17841426388985797"` |
| **Guardia** | `$.outcome != "ok"` |
| **Silencio del parser** | `$.action = "webhook_receive" AND $.count = 0 AND $.messagingCount > 0` |

Cómo se lee la primera: si **no hay ninguna fila**, Meta no te está llamando —el
modo de la app, la suscripción de la cuenta, o la URL del webhook—. Si hay filas
con `outcome != "ok"`, el motivo está en la fila (`signature_mismatch` es el App
Secret equivocado; `verify_token_mismatch` es el verify token).

La de guardia debería ser una lista corta y aburrida. Si está **vacía y hay
tráfico**, la instrumentación se rompió.

> El prefijo puede renderizar como `$.accountId` o `$.message.accountId` según
> cómo aplane Workers Logs el objeto. Hacer clic en el campo de una fila de
> muestra para que la UI arme el filtro, y guardar la vista.

### Con `wrangler tail`

`--search` solo hace match de texto crudo y no filtra por campos JSON, y
`--status error` filtra por el resultado de la **invocación** y no por el nivel
de log —así que no encuentra un webhook que respondió 200 y descartó un evento—.
De ahí el `jq`:

```bash
# la consulta de guardia: solo lo que no salió bien
npx wrangler tail --config apps/web/wrangler.jsonc --format json \
  | jq -c '.logs[]?.message[0]? | select(type=="object") | select(.outcome and .outcome!="ok")'

# todo lo que pasó con una cuenta
npx wrangler tail --config apps/web/wrangler.jsonc --format json \
  | jq -c '.logs[]?.message[0]? | select(.accountId=="17841426388985797")'

# reconstruir un POST entero: el sobre, sus N eventos y sus N entregas
npx wrangler tail --config apps/web/wrangler.jsonc --format json \
  | jq -c '.logs[]?.message[0]? | select(.requestId=="<uuid>")'

# el worker api
npx wrangler tail --config apps/web/wrangler.jsonc --format json \
  | jq -c '.logs[]?.message[0]?'
```

---

## Los tres incidentes que esto resuelve

Los tres están documentados en el *Registro de implementación* y los tres se
manifestaron igual: **no llegaba nada y no había un solo error que mirar**.

| Incidente | La línea que ahora existe |
|---|---|
| **Etapa 9 pt. 6** — `INSTAGRAM_APP_SECRET` equivocado: la ruta rechazaba todo con 401 sin registrar nada, y el síntoma se veía igual que «no llega nada» | `webhook_receive_dropped` / `signature_mismatch`, en `warn` |
| **Etapa 9 pt. 5** — la app de Meta en modo desarrollo: cero entregas, ningún error, cuatro chequeos en verde | **Ausencia** de filas `webhook_receive`: Meta no está llamando |
| **Etapa 5** — un parser que deja de reconocer el payload y devuelve cero eventos | `webhook_receive` con `count: 0` y `messagingCount: 1`: el sobre traía algo y el parser no lo reconoció |

---

## Verificación local (ngrok)

Cada uno es una prueba **negativa**, que es el punto.

1. `GET …/api/meta/instagram/webhook?hub.mode=subscribe&hub.verify_token=MAL&hub.challenge=x`
   → `webhook_verify_dropped` / `verify_token_mismatch`.
2. Poner un `INSTAGRAM_APP_SECRET` equivocado en `.env` y mandar un evento real
   → `webhook_receive_dropped` / `signature_mismatch`. **Reproduce la etapa 9
   punto 6 a propósito.**
3. DM real a la cuenta conectada. Tres líneas con el **mismo `requestId`**:
   `webhook_receive_ok count:1` → `inbound_ingest_ok` con `accountId` y
   `accountHandle` → `webhook_delivery_ok status:200`.
4. Responder desde la propia cuenta → **ninguna** línea `inbound_ingest`, y
   `webhook_receive_ok` con `count:0` y `messagingCount:1`. Esa asimetría es el
   pago de los conteos del sobre.
5. Comentar, responder en público, y esperar el webhook de la propia respuesta
   → `inbound_ingest_dropped` / `own_published_comment`.
6. Repetir el mismo body firmado → `inbound_ingest_duplicate` /
   `already_ingested`.
7. `update connected_pages set status='disconnected' where meta_page_id=…` y
   mandar un DM → `dropped` / `account_not_connected` **con el canal**.
8. Apuntar el `webhookUrl` a algo que devuelva 500 → `retry`, `retry`,
   `failed` / `max_attempts_exhausted`.

---

## Muestreo

`head_sampling_rate` está en **1** en los dos workers y no hay que bajarlo. El
muestreo de Cloudflare es por **invocación**: con 0.25, tres de cada cuatro
webhooks no conservan ninguna línea, y cada log de descarte tendría 75 % de
probabilidad de no existir justo cuando se lo va a buscar. Si alguna vez hace
falta bajar volumen, se muestrean los `traces`.

No hay `LOG_LEVEL`: sería una forma soportada de apagar los logs, y el punto es
que estén siempre. El control de volumen vive en un solo lugar, en wrangler.

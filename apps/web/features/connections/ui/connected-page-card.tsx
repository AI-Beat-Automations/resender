"use client"

import Link from "next/link"
import { useActionState } from "react"
import {
  Check,
  KeyRound,
  LoaderCircle,
  TriangleAlert,
  Unplug,
} from "lucide-react"

import {
  disconnectPageAction,
  rotateWebhookSecretAction,
  saveWebhookUrlAction,
  type ConnectionActionState,
} from "@/features/connections/actions"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  CONNECTION_STATUS_BADGE,
  resolveConnectionStatus,
} from "@/lib/pages/channel-display"
import {
  CHANNEL_LABEL,
  CHANNEL_NOUN,
  COEXISTENCE_LIMITS,
  ONBOARDING_MODE_LABEL,
  TOKEN_INVALID_BODY,
  formatConnectionIdentity,
  resolveHistorySyncNotice,
  resolveReconnectHref,
  showsCoexistenceLimits,
  type HistorySyncNotice,
  type HistorySyncStatus,
  type WhatsappOnboardingMode,
} from "@/lib/pages/connection-display"
import type { ChannelAccess } from "@/lib/auth/channel-access"
import type { PageChannel } from "@/lib/pages/page-registry"

// Tarjeta de página conectada (spec B2 + galería de estados B3). Las fechas
// llegan ya formateadas desde el server component: el `Date` crudo no cruza el
// límite serializable y el formato no depende de la zona del navegador.
export type ConnectedPageView = {
  id: string
  channel: PageChannel
  // Permiso por canal del tenant (ADR 0010). Viaja entero en cada tarjeta —y no
  // solo la bandera del canal de esta— porque la tarjeta ya recibe su `channel`
  // y así el llamador no tiene que elegir cuál mandarle; en Messenger, que no
  // tiene bandera, siempre es `true`.
  access: ChannelAccess
  metaPageId: string
  name: string
  username: string | null
  // Identidad y estado de WhatsApp (migración 0017). Null en los otros dos
  // canales: no tienen ni WABA, ni número, ni historial que importar.
  wabaId: string | null
  whatsappPhoneE164: string | null
  onboardingMode: WhatsappOnboardingMode | null
  coexistenceStatus: string | null
  historySyncStatus: HistorySyncStatus | null
  status: "active" | "disconnected"
  tokenStatus: "valid" | "invalid"
  tokenError: string | null
  webhookUrl: string | null
  // Booleano, nunca el secreto: esto cruza al cliente.
  hasSigningSecret: boolean
  connectedAt: string
  connectedAtLabel: string
  tokenErrorAt: string | null
  tokenErrorAtLabel: string | null
  disconnectedAt: string | null
  disconnectedAtLabel: string | null
}

export function ConnectedPageCard({
  page,
  showWebhookHint = false,
}: {
  page: ConnectedPageView
  // El hint del webhook se dice una vez por lista, no una vez por tarjeta.
  showWebhookHint?: boolean
}) {
  const [saveState, saveAction, savePending] = useActionState<
    ConnectionActionState,
    FormData
  >(saveWebhookUrlAction, {})
  const [rotateState, rotateAction, rotatePending] = useActionState<
    ConnectionActionState,
    FormData
  >(rotateWebhookSecretAction, {})

  // El secreto se muestra una sola vez, venga de haber guardado la URL (que lo
  // genera si faltaba) o de una rotación explícita. No se guarda en ningún lado:
  // si el usuario recarga, se fue.
  const revealedSecret = rotateState.revealedSecret ?? saveState.revealedSecret
  const active = page.status === "active"
  // `status` y `token_status` son ejes independientes (ADR 0005): una página
  // activa puede tener el token rechazado. En una desconectada el token ya no
  // dice nada útil —no recibe tráfico—, así que ahí no se muestra.
  const tokenInvalid = active && page.tokenStatus === "invalid"
  // El tercer eje (ADR 0010): la cuenta puede estar activa y con el token
  // válido, y aun así no tener el canal habilitado.
  const status = resolveConnectionStatus(page)
  const statusBadge = CONNECTION_STATUS_BADGE[status]
  const noAccess = status === "no-access"
  const messenger = page.channel === "messenger"
  // Nada de `channel === "instagram" ? … : …`: con el ternario, el canal nuevo
  // caía en la rama de descarte y una conexión de WhatsApp se pintaba
  // «Messenger» sin que nada fallara. Todo lo que depende del canal sale de los
  // catálogos exhaustivos de `connection-display.ts`.
  const identity = formatConnectionIdentity(page)
  const reconnectHref = resolveReconnectHref(page)
  const historySync = resolveHistorySyncNotice(page)
  const coexistence = showsCoexistenceLimits(page)

  return (
    <article
      className={`rounded-2xl border border-border bg-card p-[22px] shadow-[var(--shadow-sm)] ${
        active ? "" : "opacity-75"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* En WhatsApp el titular es el número, no el `name`: es lo que el
                usuario reconoce, y el `phone_number_id` que guarda
                `metaPageId` no le dice nada. */}
            <h3 className="font-heading text-base font-semibold">
              {identity.title}
            </h3>
            {/* El canal va primero y siempre: con tres canales en la misma
                lista es el dato que ordena todo lo demás —qué diálogo la
                reconecta, qué endpoint le envía— y sin él las tarjetas son
                indistinguibles salvo por el id. */}
            <Badge variant="outline">{CHANNEL_LABEL[page.channel]}</Badge>
            {/* Los dos badges conviven en lugar de pisarse: este describe el
                tráfico —«sin acceso» es tráfico cortado por el permiso del
                canal—, y el de al lado describe el token. */}
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            {tokenInvalid && (
              <Badge variant="destructive">token inválido</Badge>
            )}
          </div>
          <p className="mt-1 font-mono text-[11.5px] text-[var(--text-subtle)]">
            {/* Los ids que el usuario cita en un correo de soporte: el IG ID en
                Instagram, y el WABA junto al `phone_number_id` en WhatsApp —un
                WABA puede tener varios números, así que sin él dos tarjetas del
                mismo negocio son indistinguibles. */}
            {identity.identity} · conectada el{" "}
            <time dateTime={page.connectedAt}>{page.connectedAtLabel}</time>
          </p>
        </div>

        {active ? (
          <DisconnectDialog page={page} />
        ) : messenger ? (
          // Una página desconectada del mismo tenant vuelve a `selectable`
          // (page-selection.ts:75), así que reconectarla es elegirla otra vez.
          // Es el único canal con pantalla de selección.
          <Button asChild variant="outline" size="sm">
            <Link href="/connections/select">Volver a conectar</Link>
          </Button>
        ) : (
          // Instagram y WhatsApp no tienen pantalla de selección —el diálogo
          // autoriza assets concretos—, así que reconectar es volver a
          // autorizar directo, cada uno por su propio flujo.
          <Button asChild variant="outline" size="sm">
            <a href={reconnectHref}>Volver a conectar</a>
          </Button>
        )}
      </div>

      {/* La cuenta se sigue viendo —es suya, y su historial también—, pero acá
          se dice por qué está muda. Va antes que el aviso del token: si los dos
          coinciden, reconectar no devuelve el canal. */}
      {noAccess && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-warning-soft-border bg-warning-soft p-3.5 text-warning-soft-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">
              El canal de {CHANNEL_LABEL[page.channel]} no está habilitado para
              tu cuenta.
            </p>
            <p className="mt-1 text-[13px]/[1.55]">
              La conexión sigue en pie y su historial disponible, pero no recibe
              mensajes nuevos y no puede responder. Escríbenos a
              info@resender.dev para habilitarlo.
            </p>
          </div>
        </div>
      )}

      {tokenInvalid && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-destructive-soft-border bg-destructive-soft p-3.5 text-destructive-soft-foreground sm:flex-row sm:items-center">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">
              Hay que reconectar {CHANNEL_NOUN[page.channel]}.
            </p>
            <p className="mt-1 text-[13px]/[1.55]">
              {TOKEN_INVALID_BODY[page.channel]}
            </p>
            {(page.tokenError || page.tokenErrorAtLabel) && (
              <p className="mt-2 font-mono text-[11px] opacity-85">
                {[
                  page.tokenError,
                  page.tokenErrorAtLabel
                    ? `detectado el ${page.tokenErrorAtLabel}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          {/* El botón vive junto al error: hasta ahora el aviso decía
              «reconéctala desde Facebook» y el botón estaba en otra sección
              (ADR 0005). No se deshabilita por falta de cupo. */}
          <Button
            asChild
            size="sm"
            className="shrink-0 self-start sm:self-center"
          >
            <a href={reconnectHref}>Reconectar</a>
          </Button>
        </div>
      )}

      {/* Lo propio de WhatsApp. Va antes del webhook porque responde a la
          pregunta anterior —«¿este número está listo?»— y porque el estado del
          historial es accionable con plazo: dejarlo debajo del formulario lo
          escondería justo cuando corre el reloj de 24 h. */}
      {page.channel === "whatsapp" && (
        <div className="mt-4 grid gap-3">
          <dl className="flex flex-wrap gap-x-6 gap-y-1.5 font-mono text-[11.5px] text-muted-foreground">
            <div className="flex gap-1.5">
              <dt className="text-[var(--text-subtle)]">alta:</dt>
              <dd>
                {page.onboardingMode
                  ? ONBOARDING_MODE_LABEL[page.onboardingMode]
                  : "sin registrar"}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-[var(--text-subtle)]">token:</dt>
              <dd>
                {page.tokenStatus === "valid" ? "válido" : "rechazado por Meta"}
              </dd>
            </div>
            {/* La suscripción del WABA es lo que decide si llegan webhooks, y es
                independiente del token: un número puede tener el token bien y no
                estar suscrito, y ahí el silencio no tiene ninguna otra pista. */}
            <div className="flex gap-1.5">
              <dt className="text-[var(--text-subtle)]">suscripción:</dt>
              <dd>{page.coexistenceStatus ?? "sin datos"}</dd>
            </div>
          </dl>

          {historySync && (
            <HistorySyncPanel
              notice={historySync}
              reconnectHref={reconnectHref}
            />
          )}

          {coexistence && (
            <div className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
              <p className="text-[13px] font-medium">Límites de Coexistence</p>
              <ul className="mt-1.5 grid gap-1 text-[12.5px]/[1.55] text-muted-foreground">
                {COEXISTENCE_LIMITS.map((limit) => (
                  <li key={limit} className="flex gap-2">
                    <span aria-hidden>·</span>
                    <span>{limit}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {active ? (
        <>
          <form action={saveAction} className="mt-4 grid gap-2">
            <input type="hidden" name="connectionId" value={page.id} />
            <Label htmlFor={`webhook-${page.id}`}>Webhook URL</Label>
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <Input
                id={`webhook-${page.id}`}
                name="webhookUrl"
                type="url"
                defaultValue={page.webhookUrl ?? ""}
                placeholder="https://tu-automatizacion.example/webhook"
                aria-invalid={saveState.error ? true : undefined}
                className="flex-1 font-mono"
              />
              <Button type="submit" size="lg" disabled={savePending}>
                {savePending && (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                )}
                {savePending ? "Guardando…" : "Guardar"}
              </Button>
            </div>
            {saveState.error ? (
              <p className="text-[12.5px] text-[var(--danger-text)]">
                {saveState.error}
              </p>
            ) : saveState.message ? (
              <p className="flex items-center gap-1.5 text-[12.5px] text-success-text">
                <Check className="size-3.5" aria-hidden />
                {saveState.message}
              </p>
            ) : showWebhookHint ? (
              <p className="text-[12.5px] text-muted-foreground">
                Cada mensaje entrante se reenvía con un POST a esta URL.
              </p>
            ) : null}
          </form>

          {/* Firma del push. Va debajo de la URL porque solo tiene sentido cuando
            hay una: el secreto firma lo que se manda a ese destino. */}
          <div className="mt-3.5 grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5">
                <KeyRound className="size-3.5" aria-hidden />
                Secreto de firma
              </Label>
              <form action={rotateAction}>
                <input type="hidden" name="connectionId" value={page.id} />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={rotatePending}
                >
                  {rotatePending && (
                    <LoaderCircle
                      className="size-3.5 animate-spin"
                      aria-hidden
                    />
                  )}
                  {rotatePending
                    ? "Rotando…"
                    : page.hasSigningSecret
                      ? "Rotar"
                      : "Generar"}
                </Button>
              </form>
            </div>

            {revealedSecret ? (
              <div className="grid gap-1.5 rounded-lg border border-[var(--warning-border,var(--border))] bg-surface-sunken px-3.5 py-3">
                <p className="text-[12.5px] font-medium">
                  Cópialo ahora: no vuelve a mostrarse.
                </p>
                <code className="block overflow-x-auto rounded bg-background px-2.5 py-2 font-mono text-[12.5px] select-all">
                  {revealedSecret}
                </code>
              </div>
            ) : rotateState.error ? (
              <p className="text-[12.5px] text-[var(--danger-text)]">
                {rotateState.error}
              </p>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                {page.hasSigningSecret
                  ? "Cada POST lleva las cabeceras resender-signature, resender-event-id y resender-timestamp. Rotar invalida el secreto anterior."
                  : "Todavía sin firma: el receptor no puede verificar que el POST venga de Resender."}
              </p>
            )}
          </div>
        </>
      ) : (
        // Desconectar es un UPDATE, no un DELETE: conviene decirlo donde el
        // usuario duda de si perdió algo.
        <p className="mt-3.5 rounded-lg bg-surface-sunken px-3.5 py-3 text-[13px] text-muted-foreground">
          {page.disconnectedAtLabel
            ? `Desconectada el ${page.disconnectedAtLabel}. `
            : "Desconectada. "}
          El historial sigue disponible en el log de mensajes.
        </p>
      )}
    </article>
  )
}

// Tinte por tono. El `Record` evita el `if` encadenado que se olvida de un
// tono nuevo y lo pinta de gris.
const HISTORY_SYNC_TONE: Record<HistorySyncNotice["tone"], string> = {
  info: "border-info-soft-border bg-info-soft text-info-soft-foreground",
  success:
    "border-success-soft-border bg-success-soft text-success-soft-foreground",
  warning:
    "border-warning-soft-border bg-warning-soft text-warning-soft-foreground",
  danger:
    "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground",
}

/**
 * Estado del import de historial de Coexistence. El botón aparece **solo** en
 * `failed` y `expired`, que son los dos estados donde el historial no va a
 * llegar solo: en los otros cuatro invitaría a rehacer una conexión que está
 * avanzando bien, y en Coexistence rehacerla no es gratis.
 */
function HistorySyncPanel({
  notice,
  reconnectHref,
}: {
  notice: HistorySyncNotice
  reconnectHref: string
}) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border p-3.5 sm:flex-row sm:items-center ${HISTORY_SYNC_TONE[notice.tone]}`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11.5px] tracking-[0.04em]">
          {notice.label}
        </p>
        <p className="mt-1 text-[13px]/[1.55]">{notice.body}</p>
      </div>
      {notice.actionLabel && (
        <Button
          asChild
          size="sm"
          variant="outline"
          className="shrink-0 self-start sm:self-center"
        >
          <a href={reconnectHref}>{notice.actionLabel}</a>
        </Button>
      )}
    </div>
  )
}

function DisconnectDialog({ page }: { page: ConnectedPageView }) {
  const [state, action, pending] = useActionState<
    ConnectionActionState,
    FormData
  >(disconnectPageAction, {})

  return (
    // Diálogo en lugar del `window.confirm` (ADR 0005). Al desconectarse la
    // tarjeta se vuelve a pintar sin diálogo, así que se cierra sola.
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-[var(--danger-text)]"
        >
          Desconectar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span
            className="flex size-9 items-center justify-center rounded-full bg-destructive-soft text-destructive-soft-foreground"
            aria-hidden
          >
            <Unplug className="size-[17px]" />
          </span>
          <DialogTitle className="mt-3.5 text-[17px] tracking-[-0.02em]">
            ¿Desconectar {page.name}?
          </DialogTitle>
          <DialogDescription className="mt-2 text-[13.5px]/[1.6]">
            Dejará de recibir tráfico nuevo, pero el historial se conserva.
            Puedes volver a conectarla más adelante.
          </DialogDescription>
        </DialogHeader>
        <form action={action}>
          <input type="hidden" name="connectionId" value={page.id} />
          {state.error && (
            <p className="mb-3 text-[12.5px] text-[var(--danger-text)]">
              {state.error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="lg">
                Cancelar
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              size="lg"
              disabled={pending}
            >
              {pending && (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              )}
              {pending ? "Desconectando…" : "Sí, desconectar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

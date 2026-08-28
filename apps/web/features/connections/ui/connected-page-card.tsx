"use client"

import Link from "next/link"
import { useActionState, useState, useTransition } from "react"
import {
  Check,
  KeyRound,
  LoaderCircle,
  TriangleAlert,
  Unplug,
} from "lucide-react"

import { revealWhatsappPin } from "@/features/connect-whatsapp/actions"
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
  CONNECTION_STATUS_VARIANT,
  resolveConnectionStatus,
} from "@/lib/pages/channel-display"
import {
  formatConnectionIdentity,
  resolveHistorySyncNotice,
  resolveReconnectHref,
  offersPinReveal,
  showsCoexistenceLimits,
  type HistorySyncNotice,
  type HistorySyncStatus,
  type WhatsappOnboardingMode,
} from "@/lib/pages/connection-display"
import { fmt, type AppDict } from "@/content/i18n/app"
import { useAppDict } from "@/content/i18n/app/provider"
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
  // Si el PIN de dos pasos lo generamos nosotros. Es un booleano y nunca el PIN:
  // el valor se pide bajo demanda a una server action, para que no viaje en el
  // HTML de la pantalla ni quede en el caché del navegador.
  whatsappPinGenerated: boolean
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

  const t = useAppDict()
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
  const statusVariant = CONNECTION_STATUS_VARIANT[status]
  const noAccess = status === "no-access"
  const messenger = page.channel === "messenger"
  // Nada de `channel === "instagram" ? … : …`: con el ternario, el canal nuevo
  // caía en la rama de descarte y una conexión de WhatsApp se pintaba
  // «Messenger» sin que nada fallara. Todo lo que depende del canal sale de los
  // catálogos exhaustivos de `connection-display.ts`.
  const identity = formatConnectionIdentity(page)
  const reconnectHref = resolveReconnectHref(page)
  const historySync = resolveHistorySyncNotice(page, t)
  const coexistence = showsCoexistenceLimits(page)
  const pinReveal = offersPinReveal(page)

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
            <Badge variant="outline">{t.channels.label[page.channel]}</Badge>
            {/* Los dos badges conviven en lugar de pisarse: este describe el
                tráfico —«sin acceso» es tráfico cortado por el permiso del
                canal—, y el de al lado describe el token. */}
            <Badge variant={statusVariant}>
              {t.channels.statusBadge[status]}
            </Badge>
            {tokenInvalid && (
              <Badge variant="destructive">
                {t.connectionCard.tokenInvalidBadge}
              </Badge>
            )}
          </div>
          <p className="mt-1 font-mono text-[11.5px] text-[var(--text-subtle)]">
            {/* Los ids que el usuario cita en un correo de soporte: el IG ID en
                Instagram, y el WABA junto al `phone_number_id` en WhatsApp —un
                WABA puede tener varios números, así que sin él dos tarjetas del
                mismo negocio son indistinguibles. */}
            {identity.identity} · {t.connectionCard.connectedOn}{" "}
            <time dateTime={page.connectedAt}>{page.connectedAtLabel}</time>
          </p>
        </div>

        {active ? (
          <DisconnectDialog page={page} t={t} />
        ) : messenger ? (
          // Una página desconectada del mismo tenant vuelve a `selectable`
          // (page-selection.ts:75), así que reconectarla es elegirla otra vez.
          // Es el único canal con pantalla de selección.
          <Button asChild variant="outline" size="sm">
            <Link href="/connections/select">
              {t.connectionCard.reconnectAgain}
            </Link>
          </Button>
        ) : (
          // Instagram y WhatsApp no tienen pantalla de selección —el diálogo
          // autoriza assets concretos—, así que reconectar es volver a
          // autorizar directo, cada uno por su propio flujo.
          <Button asChild variant="outline" size="sm">
            <a href={reconnectHref}>{t.connectionCard.reconnectAgain}</a>
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
              {fmt(t.connectionCard.noAccessTitle, {
                channel: t.channels.label[page.channel],
              })}
            </p>
            <p className="mt-1 text-[13px]/[1.55]">
              {t.connectionCard.noAccessBody}
            </p>
          </div>
        </div>
      )}

      {tokenInvalid && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-destructive-soft-border bg-destructive-soft p-3.5 text-destructive-soft-foreground sm:flex-row sm:items-center">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">
              {fmt(t.connectionCard.tokenInvalidTitle, {
                noun: t.channels.noun[page.channel],
              })}
            </p>
            <p className="mt-1 text-[13px]/[1.55]">
              {t.channels.tokenInvalidBody[page.channel]}
            </p>
            {(page.tokenError || page.tokenErrorAtLabel) && (
              <p className="mt-2 font-mono text-[11px] opacity-85">
                {[
                  page.tokenError,
                  page.tokenErrorAtLabel
                    ? fmt(t.connectionCard.tokenErrorDetectedOn, {
                        date: page.tokenErrorAtLabel,
                      })
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
            <a href={reconnectHref}>{t.connectionCard.reconnect}</a>
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
              <dt className="text-[var(--text-subtle)]">
                {t.connectionCard.whatsappOnboardingLabel}
              </dt>
              <dd>
                {page.onboardingMode
                  ? t.channels.onboardingMode[page.onboardingMode]
                  : t.connectionCard.whatsappOnboardingUnknown}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-[var(--text-subtle)]">
                {t.connectionCard.whatsappTokenLabel}
              </dt>
              <dd>
                {page.tokenStatus === "valid"
                  ? t.connectionCard.whatsappTokenValid
                  : t.connectionCard.whatsappTokenRejected}
              </dd>
            </div>
            {/* La suscripción del WABA es lo que decide si llegan webhooks, y es
                independiente del token: un número puede tener el token bien y no
                estar suscrito, y ahí el silencio no tiene ninguna otra pista. */}
            <div className="flex gap-1.5">
              <dt className="text-[var(--text-subtle)]">
                {t.connectionCard.whatsappSubscriptionLabel}
              </dt>
              <dd>
                {page.coexistenceStatus ??
                  t.connectionCard.whatsappSubscriptionUnknown}
              </dd>
            </div>
          </dl>

          {historySync && (
            <HistorySyncPanel
              notice={historySync}
              reconnectHref={reconnectHref}
            />
          )}

          {pinReveal && <WhatsappPinPanel connectionId={page.id} t={t} />}

          {coexistence && (
            <div className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
              <p className="text-[13px] font-medium">
                {t.connectionCard.coexistenceLimitsTitle}
              </p>
              <ul className="mt-1.5 grid gap-1 text-[12.5px]/[1.55] text-muted-foreground">
                {t.channels.coexistenceLimits.map((limit) => (
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
            <Label htmlFor={`webhook-${page.id}`}>
              {t.connectionCard.webhookLabel}
            </Label>
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <Input
                id={`webhook-${page.id}`}
                name="webhookUrl"
                type="url"
                defaultValue={page.webhookUrl ?? ""}
                placeholder={t.connectionCard.webhookPlaceholder}
                aria-invalid={saveState.error ? true : undefined}
                className="flex-1 font-mono"
              />
              <Button type="submit" size="lg" disabled={savePending}>
                {savePending && (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                )}
                {savePending ? t.common.saving : t.common.save}
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
                {t.connectionCard.webhookHint}
              </p>
            ) : null}
          </form>

          {/* Firma del push. Va debajo de la URL porque solo tiene sentido cuando
            hay una: el secreto firma lo que se manda a ese destino. */}
          <div className="mt-3.5 grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5">
                <KeyRound className="size-3.5" aria-hidden />
                {t.connectionCard.signingSecretLabel}
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
                    ? t.connectionCard.rotating
                    : page.hasSigningSecret
                      ? t.connectionCard.rotate
                      : t.connectionCard.generate}
                </Button>
              </form>
            </div>

            {revealedSecret ? (
              <div className="grid gap-1.5 rounded-lg border border-[var(--warning-border,var(--border))] bg-surface-sunken px-3.5 py-3">
                <p className="text-[12.5px] font-medium">
                  {t.connectionCard.secretRevealTitle}
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
                  ? t.connectionCard.secretWithBody
                  : t.connectionCard.secretWithoutBody}
              </p>
            )}
          </div>
        </>
      ) : (
        // Desconectar es un UPDATE, no un DELETE: conviene decirlo donde el
        // usuario duda de si perdió algo.
        <p className="mt-3.5 rounded-lg bg-surface-sunken px-3.5 py-3 text-[13px] text-muted-foreground">
          {page.disconnectedAtLabel
            ? fmt(t.connectionCard.disconnectedOn, {
                date: page.disconnectedAtLabel,
              })
            : t.connectionCard.disconnectedNoDate}
          {t.connectionCard.disconnectedHistoryKept}
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

// El PIN de verificación en dos pasos que **generamos nosotros** al registrar el
// número (migración 0017). Meta no lo vuelve a mostrar y no tiene endpoint de
// lectura, así que esta pantalla es el único lugar del mundo donde el cliente
// puede recuperarlo. Sin esto, reconectar el mismo número en otro entorno falla
// con un `133005` pidiendo un PIN que inventamos y que nadie puede consultar.
//
// **Bajo demanda y nunca en el HTML.** El valor se pide a la server action al
// pulsar, en vez de viajar con la pantalla: un PIN embebido en el markup queda
// en el caché del navegador y en cualquier captura de la página de Conexiones,
// que es donde el cliente entra por otras cosas todo el tiempo.
//
// Se puede volver a ocultar a propósito: es un secreto que se lee, se anota y se
// guarda, no algo que tenga que quedar a la vista del resto de la sesión.
function WhatsappPinPanel({
  connectionId,
  t,
}: {
  connectionId: string
  t: AppDict
}) {
  const [pin, setPin] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const reveal = () => {
    setError(null)
    startTransition(async () => {
      const result = await revealWhatsappPin(connectionId)
      if ("pin" in result && result.pin) {
        setPin(result.pin)
        return
      }
      setError(
        "error" in result && result.error
          ? result.error
          : t.connectionCard.pinError
      )
    })
  }

  return (
    <div className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
      <p className="text-[13px] font-medium">{t.connectionCard.pinTitle}</p>
      <p className="mt-1 text-[12.5px]/[1.55] text-muted-foreground">
        {t.connectionCard.pinBody}
      </p>

      {pin ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          <code className="rounded-md border border-border bg-card px-2.5 py-1 font-mono text-[15px] tracking-[0.2em]">
            {pin}
          </code>
          <Button variant="ghost" size="sm" onClick={() => setPin(null)}>
            {t.connectionCard.pinHide}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="mt-2.5"
          onClick={reveal}
          disabled={pending}
        >
          {pending && (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          )}
          {pending ? t.connectionCard.pinRevealing : t.connectionCard.pinReveal}
        </Button>
      )}

      {error && (
        <p className="mt-2 text-[12.5px]/[1.55] text-[var(--danger-text)]">
          {error}
        </p>
      )}
    </div>
  )
}

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

function DisconnectDialog({
  page,
  t,
}: {
  page: ConnectedPageView
  t: AppDict
}) {
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
          {t.connectionCard.disconnect}
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
            {fmt(t.connectionCard.disconnectTitle, { name: page.name })}
          </DialogTitle>
          <DialogDescription className="mt-2 text-[13.5px]/[1.6]">
            {t.connectionCard.disconnectBody}
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
                {t.common.cancel}
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
              {pending
                ? t.connectionCard.disconnecting
                : t.connectionCard.disconnectConfirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

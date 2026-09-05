"use client"

import Link from "next/link"
import { useActionState, useState, useTransition } from "react"
import {
  Check,
  Copy,
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
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"

import { ChannelAvatar } from "./channel-avatar"
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
    <Card
      className={cn(
        "gap-0 py-0",
        // Una desconectada se apaga: fondo hundido y sin sombra (mock 1e).
        !active && "bg-surface-sunken text-muted-foreground"
      )}
    >
      <div className="flex flex-col gap-3 px-5 py-[18px] sm:flex-row sm:items-center sm:gap-3.5">
        <ChannelAvatar channel={page.channel} muted={!active} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* En WhatsApp el titular es el número, no el `name`: es lo que el
                usuario reconoce, y el `phone_number_id` que guarda
                `metaPageId` no le dice nada. */}
            <h3
              className={cn(
                "font-heading text-[15.5px] font-semibold",
                active ? "text-foreground" : "text-muted-foreground"
              )}
            >
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
              <Badge variant="destructiveSoft">
                {t.connectionCard.tokenInvalidBadge}
              </Badge>
            )}
          </div>
          {active ? (
            <p className="mt-1 font-mono text-[11.5px] text-[var(--text-subtle)]">
              {/* Los ids que el usuario cita en un correo de soporte: el IG ID
                  en Instagram, y el WABA junto al `phone_number_id` en WhatsApp
                  —un WABA puede tener varios números, así que sin él dos
                  tarjetas del mismo negocio son indistinguibles. */}
              {identity.identity} · {t.connectionCard.connectedOn}{" "}
              <time dateTime={page.connectedAt}>{page.connectedAtLabel}</time>
            </p>
          ) : (
            // Desconectar es un UPDATE, no un DELETE: conviene decirlo donde
            // el usuario duda de si perdió algo.
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {page.disconnectedAtLabel
                ? fmt(t.connectionCard.disconnectedOn, {
                    date: page.disconnectedAtLabel,
                  })
                : t.connectionCard.disconnectedNoDate}
              {t.connectionCard.disconnectedHistoryKept}
            </p>
          )}
        </div>

        {active ? (
          <DisconnectDialog page={page} t={t} />
        ) : messenger ? (
          // Una página desconectada del mismo tenant vuelve a `selectable`
          // (page-selection.ts:75), así que reconectarla es elegirla otra vez.
          // Es el único canal con pantalla de selección.
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/connections/select">
              {t.connectionCard.reconnectAgain}
            </Link>
          </Button>
        ) : (
          // Instagram y WhatsApp no tienen pantalla de selección —el diálogo
          // autoriza assets concretos—, así que reconectar es volver a
          // autorizar directo, cada uno por su propio flujo.
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <a href={reconnectHref}>{t.connectionCard.reconnectAgain}</a>
          </Button>
        )}
      </div>

      {/* La cuenta se sigue viendo —es suya, y su historial también—, pero acá
          se dice por qué está muda. Va antes que el aviso del token: si los dos
          coinciden, reconectar no devuelve el canal. */}
      {noAccess && (
        <Alert variant="warning" className={ALERT_IN_CARD}>
          <TriangleAlert aria-hidden />
          <AlertTitle>
            {fmt(t.connectionCard.noAccessTitle, {
              channel: t.channels.label[page.channel],
            })}
          </AlertTitle>
          <AlertDescription>{t.connectionCard.noAccessBody}</AlertDescription>
        </Alert>
      )}

      {tokenInvalid && (
        <Alert
          variant="destructive"
          className={cn(ALERT_IN_CARD, ALERT_WITH_ACTION)}
        >
          <TriangleAlert aria-hidden />
          <AlertTitle>
            {fmt(t.connectionCard.tokenInvalidTitle, {
              noun: t.channels.noun[page.channel],
            })}
          </AlertTitle>
          <AlertDescription>
            {t.channels.tokenInvalidBody[page.channel]}
            {(page.tokenError || page.tokenErrorAtLabel) && (
              <span className="mt-1.5 block font-mono text-[11px] opacity-85">
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
              </span>
            )}
          </AlertDescription>
          {/* El botón vive junto al error: hasta ahora el aviso decía
              «reconéctala desde Facebook» y el botón estaba en otra sección
              (ADR 0005). No se deshabilita por falta de cupo. */}
          <Button asChild size="sm" className={ALERT_ACTION}>
            <a href={reconnectHref}>{t.connectionCard.reconnect}</a>
          </Button>
        </Alert>
      )}

      {/* Lo propio de WhatsApp. Va antes del webhook porque responde a la
          pregunta anterior —«¿este número está listo?»— y porque el estado del
          historial es accionable con plazo: dejarlo debajo del formulario lo
          escondería justo cuando corre el reloj de 24 h. */}
      {page.channel === "whatsapp" && (
        <div className="mx-5 mb-[18px] grid gap-3">
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
            <Alert role="note" className="bg-surface-sunken">
              <AlertTitle className="text-[13px]">
                {t.connectionCard.coexistenceLimitsTitle}
              </AlertTitle>
              <AlertDescription>
                <ul className="grid gap-1 text-[12.5px]/[1.55]">
                  {t.channels.coexistenceLimits.map((limit) => (
                    <li key={limit} className="flex gap-2">
                      <span aria-hidden>·</span>
                      <span>{limit}</span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {active && (
        // Cuerpo en dos columnas (mock 1e): el webhook y, al lado, la firma.
        // La firma va junto a la URL porque solo tiene sentido cuando hay una:
        // el secreto firma lo que se manda a ese destino.
        <div className="grid gap-5 border-t border-border-subtle px-5 py-4 md:grid-cols-2">
          <form action={saveAction} className="grid content-start gap-2">
            <input type="hidden" name="connectionId" value={page.id} />
            <Label htmlFor={`webhook-${page.id}`}>
              {t.connectionCard.webhookLabel}
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={`webhook-${page.id}`}
                name="webhookUrl"
                type="url"
                defaultValue={page.webhookUrl ?? ""}
                placeholder={t.connectionCard.webhookPlaceholder}
                aria-invalid={saveState.error ? true : undefined}
                className="flex-1 font-mono text-[12.5px]"
              />
              <Button type="submit" disabled={savePending}>
                {savePending && (
                  <LoaderCircle className="animate-spin" aria-hidden />
                )}
                {savePending ? t.common.saving : t.common.save}
              </Button>
            </div>
            {saveState.error ? (
              <p
                role="alert"
                className="text-[12.5px] text-[var(--danger-text)]"
              >
                {saveState.error}
              </p>
            ) : saveState.message ? (
              <p
                role="status"
                className="flex items-center gap-1.5 text-[12.5px] text-success-text"
              >
                <Check className="size-3.5" aria-hidden />
                {saveState.message}
              </p>
            ) : showWebhookHint ? (
              <p className="text-[12.5px] text-muted-foreground">
                {t.connectionCard.webhookHint}
              </p>
            ) : null}
          </form>

          <div className="grid content-start gap-2">
            <div className="flex h-5 flex-wrap items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5">
                <KeyRound className="size-3.5" aria-hidden />
                {t.connectionCard.signingSecretLabel}
              </Label>
              <form action={rotateAction}>
                <input type="hidden" name="connectionId" value={page.id} />
                <Button
                  type="submit"
                  variant="outline"
                  size="xs"
                  disabled={rotatePending}
                >
                  {rotatePending && (
                    <LoaderCircle className="animate-spin" aria-hidden />
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
              <RevealedSecret secret={revealedSecret} t={t} />
            ) : (
              // Enmascarado: el secreto nunca vuelve a leerse después del
              // revelado único, así que la caja solo dice que existe.
              <div
                className="flex h-9 items-center overflow-hidden rounded-lg border border-border bg-surface-sunken px-3 font-mono text-[12.5px] text-[var(--text-subtle)]"
                aria-hidden
              >
                {page.hasSigningSecret ? SECRET_MASK : "—"}
              </div>
            )}

            {rotateState.error ? (
              <p
                role="alert"
                className="text-[12.5px] text-[var(--danger-text)]"
              >
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
        </div>
      )}
    </Card>
  )
}

// Los avisos dentro de la tarjeta van a ras de los 20 px del cuerpo.
const ALERT_IN_CARD = "mx-5 mb-[18px] w-auto px-3.5 py-3"
// Alert con un botón a la derecha: tercera columna, botón centrado en las dos
// filas del icono. Mismo truco que la franja de cuota.
const ALERT_WITH_ACTION =
  "has-[>svg]:grid-cols-[auto_1fr_auto] has-[>svg]:gap-x-3 items-center"
const ALERT_ACTION = "col-start-3 row-span-2 row-start-1 shrink-0 self-center"

// Lo que dibuja la caja del secreto cuando existe pero no se puede leer. Es un
// literal visual, no copy: el prefijo `whsec_` es el del secreto real
// (`lib/pages/webhook-signing.ts`) y los puntos son el enmascarado del mock.
const SECRET_MASK = "whsec_••••••••••••••••••••"

// El secreto se muestra una sola vez (ver `revealedSecret`). «Copiar» va al
// lado porque es lo único que el usuario tiene que hacer con él antes de que
// desaparezca.
function RevealedSecret({ secret, t }: { secret: string; t: AppDict }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(secret).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Alert variant="warning" className="gap-1.5 px-3.5 py-3">
      <AlertTitle className="text-[12.5px]">
        {t.connectionCard.secretRevealTitle}
      </AlertTitle>
      <AlertDescription>
        <div className="flex items-center gap-2">
          <code className="block min-w-0 flex-1 overflow-x-auto rounded-md bg-background px-2.5 py-1.5 font-mono text-[12.5px] text-foreground select-all">
            {secret}
          </code>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={copy}
            className="shrink-0"
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? t.common.copied : t.common.copy}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

// Tono del dominio → variante de `Alert`. El `Record` evita el `if` encadenado
// que se olvida de un tono nuevo y lo pinta de gris.
const HISTORY_SYNC_VARIANT: Record<
  HistorySyncNotice["tone"],
  React.ComponentProps<typeof Alert>["variant"]
> = {
  info: "info",
  success: "success",
  warning: "warning",
  danger: "destructive",
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
    <div
      role="note"
      className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3"
    >
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
        <p
          role="alert"
          className="mt-2 text-[12.5px]/[1.55] text-[var(--danger-text)]"
        >
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
    <Alert
      variant={HISTORY_SYNC_VARIANT[notice.tone]}
      className={cn("px-3.5 py-3", notice.actionLabel && ALERT_WITH_ACTION)}
    >
      <AlertTitle className="font-mono text-[11.5px] font-normal tracking-[0.04em]">
        {notice.label}
      </AlertTitle>
      <AlertDescription>{notice.body}</AlertDescription>
      {notice.actionLabel && (
        <Button
          asChild
          size="sm"
          variant="outline"
          className="col-start-2 row-span-2 row-start-1 shrink-0 self-center justify-self-end sm:col-start-3"
        >
          <a href={reconnectHref}>{notice.actionLabel}</a>
        </Button>
      )}
    </Alert>
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
    // `AlertDialog` en lugar del `window.confirm` (ADR 0005) y del `Dialog`
    // (ADR 0015): es una confirmación destructiva. Al desconectarse la tarjeta
    // se vuelve a pintar sin diálogo, así que se cierra sola.
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground hover:text-[var(--danger-text)]"
        >
          {t.connectionCard.disconnect}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive-soft text-destructive-soft-foreground">
            <Unplug aria-hidden />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {fmt(t.connectionCard.disconnectTitle, { name: page.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t.connectionCard.disconnectBody}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="connectionId" value={page.id} />
          {state.error && (
            <Alert variant="destructive">
              <AlertTitle className="font-normal">{state.error}</AlertTitle>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t.common.cancel}
            </AlertDialogCancel>
            {/* Submit normal en vez de `AlertDialogAction`: ese cierra el
                diálogo al click y desmontaría el `<form>` antes de la action.
                El diálogo se queda abierto con el spinner hasta que la tarjeta
                se repinta desconectada (o muestra el error). */}
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" aria-hidden />}
              {pending
                ? t.connectionCard.disconnecting
                : t.connectionCard.disconnectConfirm}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

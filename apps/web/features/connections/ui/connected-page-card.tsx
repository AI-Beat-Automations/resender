"use client"

import Link from "next/link"
import { useActionState } from "react"
import { Check, LoaderCircle, TriangleAlert, Unplug } from "lucide-react"

import {
  disconnectPageAction,
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

// Tarjeta de página conectada (spec B2 + galería de estados B3). Las fechas
// llegan ya formateadas desde el server component: el `Date` crudo no cruza el
// límite serializable y el formato no depende de la zona del navegador.
export type ConnectedPageView = {
  id: string
  channel: "messenger" | "instagram"
  // Permiso de Instagram del tenant (ADR 0010). Viaja en cada tarjeta porque el
  // estado que muestra depende de él; en las de Messenger no aplica.
  instagramAccess: boolean
  metaPageId: string
  name: string
  username: string | null
  status: "active" | "disconnected"
  tokenStatus: "valid" | "invalid"
  tokenError: string | null
  webhookUrl: string | null
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
  const instagram = page.channel === "instagram"
  // Cada canal se reconecta por su propio diálogo de Meta.
  const reconnectHref = instagram
    ? "/api/meta/instagram/start"
    : "/api/meta/start"

  return (
    <article
      className={`rounded-2xl border border-border bg-card p-[22px] shadow-[var(--shadow-sm)] ${
        active ? "" : "opacity-75"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-base font-semibold">
              {page.name}
            </h3>
            {/* El canal va primero y siempre: con dos canales en la misma lista
                es el dato que ordena todo lo demás —qué diálogo la reconecta,
                qué endpoint le envía— y sin él las tarjetas son indistinguibles
                salvo por el id. */}
            <Badge variant="outline">
              {instagram ? "Instagram" : "Messenger"}
            </Badge>
            {/* Los dos badges conviven en lugar de pisarse: este describe el
                tráfico —«sin acceso» es tráfico cortado por el permiso del
                canal—, y el de al lado describe el token. */}
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            {tokenInvalid && (
              <Badge variant="destructive">token inválido</Badge>
            )}
          </div>
          <p className="mt-1 font-mono text-[11.5px] text-[var(--text-subtle)]">
            {/* En Instagram el @handle es lo que el usuario reconoce; el IG ID
                no le dice nada, pero es lo que cita en un correo de soporte. */}
            {instagram && page.username
              ? `@${page.username} · ig_id ${page.metaPageId}`
              : `page_id ${page.metaPageId}`}{" "}
            · conectada el{" "}
            <time dateTime={page.connectedAt}>{page.connectedAtLabel}</time>
          </p>
        </div>

        {active ? (
          <DisconnectDialog page={page} />
        ) : instagram ? (
          // Instagram no tiene pantalla de selección —el diálogo autoriza una
          // sola cuenta—, así que reconectar es volver a autorizar directo.
          <Button asChild variant="outline" size="sm">
            <a href={reconnectHref}>Volver a conectar</a>
          </Button>
        ) : (
          // Una página desconectada del mismo tenant vuelve a `selectable`
          // (page-selection.ts:75), así que reconectarla es elegirla otra vez.
          <Button asChild variant="outline" size="sm">
            <Link href="/connections/select">Volver a conectar</Link>
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
              El canal de Instagram no está habilitado para tu cuenta.
            </p>
            <p className="mt-1 text-[13px]/[1.55]">
              La cuenta sigue conectada y su historial disponible, pero no
              recibe mensajes ni comentarios nuevos y no puede responder.
              Escríbenos a info@resender.dev para habilitarlo.
            </p>
          </div>
        </div>
      )}

      {tokenInvalid && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-destructive-soft-border bg-destructive-soft p-3.5 text-destructive-soft-foreground sm:flex-row sm:items-center">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">
              Hay que reconectar {instagram ? "esta cuenta" : "esta página"}.
            </p>
            <p className="mt-1 text-[13px]/[1.55]">
              {instagram
                ? // El token de Instagram vence a los ~60 días, así que acá el
                  // caso habitual es el vencimiento y no un permiso revocado.
                  "Meta rechazó el token de la cuenta. Vuelve a autorizarla en Instagram para renovarlo antes de seguir enviando respuestas."
                : "Meta rechazó el token de la página. Reconéctala desde Facebook para renovar permisos antes de volver a enviar respuestas."}
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

      {active ? (
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

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
  revealWhatsappPinAction,
  saveWebhookUrlAction,
  type ConnectionActionState,
  type RevealWhatsappPinState,
} from "@/features/connections/actions"
import type {
  PageChannel,
  PageStatus,
  PageTokenStatus,
} from "@/lib/pages/page-registry"
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

// Tarjeta de página conectada (spec B2 + galería de estados B3). Las fechas
// llegan ya formateadas desde el server component: el `Date` crudo no cruza el
// límite serializable y el formato no depende de la zona del navegador.
//
// Los tres campos de canal/estado reusan los tipos de `page-registry` en vez de
// redeclarar las uniones a mano, que es lo que hacían antes y lo que dejó a
// esta tarjeta desincronizada: `PageChannel` ganó `whatsapp` y acá seguía
// diciendo `"messenger" | "instagram"`, así que el canal nuevo ni siquiera era
// representable y el `toPageView` de la pantalla habría fallado en silencio a
// nivel de tipos. Importar el tipo es la única forma de que la próxima
// ampliación llegue sola hasta acá.
export type ConnectedPageView = {
  id: string
  channel: PageChannel
  metaPageId: string
  name: string
  username: string | null
  // El número en E.164 (`+5215512345678`). Solo WhatsApp lo tiene.
  phoneE164: string | null
  // `true` solo en números de WhatsApp cuyo PIN de verificación en dos pasos
  // **generamos nosotros** al conectarlos. Es un booleano y no el PIN: el valor
  // no viaja en el render, se pide con una acción (ver `WhatsappPinPanel`).
  hasGeneratedWhatsappPin: boolean
  status: PageStatus
  tokenStatus: PageTokenStatus
  tokenError: string | null
  webhookUrl: string | null
  connectedAt: string
  connectedAtLabel: string
  tokenErrorAt: string | null
  tokenErrorAtLabel: string | null
  disconnectedAt: string | null
  disconnectedAtLabel: string | null
}

// Nombre visible del canal. Gemelo del de `features/inbox/ui/channel-badge.tsx`
// —el mismo texto se pinta en la tarjeta y en el log—, duplicado a propósito
// para no cruzar un import entre dos features. Los dos son exhaustivos, así que
// el canal que se agregue rompe la compilación en los dos sitios.
const CHANNEL_LABEL: Record<PageChannel, string> = {
  messenger: "Messenger",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
}

// Cómo se llama la cuenta en el texto corrido. Un canal por sustantivo: hablar
// de «esta página» cuando el usuario está mirando un número de teléfono es la
// clase de detalle que le hace dudar de si la pantalla entendió lo que conectó.
const CHANNEL_SUBJECT: Record<PageChannel, string> = {
  messenger: "esta página",
  instagram: "esta cuenta",
  whatsapp: "este número",
}

// Qué decirle al usuario cuando Meta rechazó el token. Cambia por canal porque
// el motivo probable cambia: en Messenger el page token no vence y un rechazo
// suele ser un permiso revocado; en Instagram vence a los ~60 días y el caso
// habitual es el vencimiento; en WhatsApp el token es del system user y un
// rechazo apunta al asset (el número o el WABA) que dejó de estar asignado.
const CHANNEL_TOKEN_ERROR_HINT: Record<PageChannel, string> = {
  messenger:
    "Meta rechazó el token de la página. Reconéctala desde Facebook para renovar permisos antes de volver a enviar respuestas.",
  instagram:
    "Meta rechazó el token de la cuenta. Vuelve a autorizarla en Instagram para renovarlo antes de seguir enviando respuestas.",
  whatsapp:
    "Meta rechazó el token del número. Vuelve a autorizarlo desde Meta para renovar permisos antes de volver a enviar respuestas.",
}

// Adónde va «Volver a conectar» / «Reconectar». No es una URL a secas porque
// los tres caminos no son el mismo tipo de navegación:
//
// - Messenger vuelve a la pantalla propia de selección: una página desconectada
//   del mismo tenant vuelve a ser `selectable` (page-selection.ts:75), así que
//   reconectarla es elegirla otra vez. Es una ruta de Next y va con `Link`.
// - Instagram no tiene pantalla de selección —el diálogo autoriza una sola
//   cuenta—, así que reconectar es navegar al endpoint que arranca el OAuth. Es
//   una navegación de documento y va con `<a>`.
// - WhatsApp **no tiene ninguna ruta**: su onboarding es el popup del Embedded
//   Signup, que abre un componente cliente (`connect-whatsapp/ui`). Reconectar
//   es volver a lanzarlo, así que el botón lleva al launcher de esta misma
//   pantalla en vez de a un endpoint. No se monta un launcher por tarjeta a
//   propósito: el nonce que arma el flujo vive en **una cookie única por
//   navegador**, así que dos launchers en la misma pantalla se pisarían el nonce
//   y el que pulsaras fallaría con `state_mismatch`. Uno solo, y las tarjetas
//   apuntan a él. El ancla es la del `div` de `connect-whatsapp-button.tsx`.
type ReconnectRoute =
  | { kind: "internal"; href: string }
  | { kind: "external"; href: string }

const CHANNEL_RECONNECT_ROUTE: Record<PageChannel, ReconnectRoute> = {
  messenger: { kind: "internal", href: "/connections/select" },
  instagram: { kind: "external", href: "/api/meta/instagram/start" },
  whatsapp: { kind: "internal", href: "/connections#conectar-whatsapp" },
}

// Renglón de identidad: qué id citar y con qué nombre. Es el dato que el
// usuario copia en un correo de soporte, así que tiene que ser el que el
// proveedor entiende, no el que la columna se llama: en WhatsApp `meta_page_id`
// guarda el `phone_number_id` (migración 0015) y llamarlo `page_id` mandaría a
// buscar una página de Facebook que no existe.
function formatIdentity(page: ConnectedPageView): string {
  switch (page.channel) {
    case "instagram":
      // El @handle es lo que el usuario reconoce; el IG ID es lo que cita en
      // soporte. Sin @handle queda el ID, pero nombrado como lo que es.
      return page.username
        ? `@${page.username} · ig_id ${page.metaPageId}`
        : `ig_id ${page.metaPageId}`
    case "whatsapp":
      // El número en E.164 es lo único que el usuario reconoce —el
      // `phone_number_id` no se parece en nada a su teléfono—, y el id es lo
      // que hace falta para cualquier consulta a Meta.
      return page.phoneE164
        ? `${page.phoneE164} · phone_number_id ${page.metaPageId}`
        : `phone_number_id ${page.metaPageId}`
    case "messenger":
      return `page_id ${page.metaPageId}`
  }
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
  const reconnectRoute = CHANNEL_RECONNECT_ROUTE[page.channel]

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
            {/* El canal va primero y siempre: con tres canales en la misma
                lista es el dato que ordena todo lo demás —qué diálogo la
                reconecta, qué endpoint le envía— y sin él las tarjetas son
                indistinguibles salvo por el id. */}
            <Badge variant="outline">{CHANNEL_LABEL[page.channel]}</Badge>
            {/* Los dos badges conviven en lugar de pisarse: «activa» describe
                el tráfico, «token inválido» describe el permiso. */}
            <Badge variant={active ? "success" : "ghost"}>
              {active ? "activa" : "desconectada"}
            </Badge>
            {tokenInvalid && (
              <Badge variant="destructive">token inválido</Badge>
            )}
          </div>
          <p className="mt-1 font-mono text-[11.5px] text-[var(--text-subtle)]">
            {formatIdentity(page)} · conectada el{" "}
            <time dateTime={page.connectedAt}>{page.connectedAtLabel}</time>
          </p>
        </div>

        {active ? (
          <DisconnectDialog page={page} />
        ) : (
          <ReconnectButton
            route={reconnectRoute}
            label="Volver a conectar"
            variant="outline"
          />
        )}
      </div>

      {tokenInvalid && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-destructive-soft-border bg-destructive-soft p-3.5 text-destructive-soft-foreground sm:flex-row sm:items-center">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">
              Hay que reconectar {CHANNEL_SUBJECT[page.channel]}.
            </p>
            <p className="mt-1 text-[13px]/[1.55]">
              {CHANNEL_TOKEN_ERROR_HINT[page.channel]}
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
          <ReconnectButton
            route={reconnectRoute}
            label="Reconectar"
            className="shrink-0 self-start sm:self-center"
          />
        </div>
      )}

      {/* Va antes del webhook y en las dos mitades —activa y desconectada—: el
          PIN sigue siendo suyo aunque el número ya no esté conectado, y
          justamente ahí es donde más falta le hace. */}
      {page.hasGeneratedWhatsappPin && <WhatsappPinPanel page={page} />}

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

// El PIN de verificación en dos pasos que le creamos al número al conectarlo.
//
// **Oculto por defecto y revelado a petición**, como cualquier credencial: el
// valor no está en el HTML de la tarjeta ni en el payload de la pantalla —lo
// devuelve `revealWhatsappPinAction`, que lo descifra en el servidor cuando
// alguien lo pide—, así que no aparece en las capturas ni en la caché de quien
// solo pasó por Conexiones.
//
// La explicación de una línea existe porque sin ella el dato no significa nada:
// el cliente no pidió esta verificación en dos pasos, se la activamos nosotros
// para poder registrar el número en Cloud API, y si borra su cuenta se queda con
// la 2FA puesta y sin la llave. Decirle qué es y por qué le conviene guardarlo
// es la mitad de la función; la otra mitad es poder leerlo.
function WhatsappPinPanel({ page }: { page: ConnectedPageView }) {
  const [state, action, pending] = useActionState<
    RevealWhatsappPinState,
    FormData
  >(revealWhatsappPinAction, {})

  return (
    <form
      action={action}
      className="mt-3.5 rounded-lg bg-surface-sunken px-3.5 py-3"
    >
      <input type="hidden" name="connectionId" value={page.id} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <KeyRound className="size-3.5 shrink-0 opacity-70" aria-hidden />
          PIN de verificación en dos pasos
        </p>
        {state.pin ? (
          <output className="font-mono text-[15px] tracking-[0.18em]">
            {state.pin}
          </output>
        ) : (
          <Button type="submit" size="sm" variant="ghost" disabled={pending}>
            {pending && (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            )}
            {pending ? "Mostrando…" : "Mostrar PIN"}
          </Button>
        )}
      </div>
      <p className="mt-1 text-[12.5px]/[1.55] text-muted-foreground">
        Se la activamos a este número al conectarlo y Meta no vuelve a mostrar el
        PIN: guárdalo, es tuyo y lo necesitarás para usar el número en otra
        plataforma o si dejas de usar Resender.
      </p>
      {state.error && (
        <p className="mt-1.5 text-[12.5px] text-[var(--danger-text)]">
          {state.error}
        </p>
      )}
    </form>
  )
}

// El botón de reconectar, que es el mismo en los dos sitios donde aparece —la
// tarjeta desconectada y el aviso de token rechazado— y por eso decide una vez
// qué envoltorio le toca a cada ruta.
function ReconnectButton({
  route,
  label,
  variant,
  className,
}: {
  route: ReconnectRoute
  label: string
  variant?: "outline"
  className?: string
}) {
  return (
    <Button asChild size="sm" variant={variant} className={className}>
      {route.kind === "internal" ? (
        <Link href={route.href}>{label}</Link>
      ) : (
        // Navegación de documento y no `Link`: el endpoint redirige a Meta, y el
        // router de Next no puede seguir una redirección fuera de la app.
        <a href={route.href}>{label}</a>
      )}
    </Button>
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

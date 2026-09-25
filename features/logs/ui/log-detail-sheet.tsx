"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { Check, Copy, X } from "lucide-react"

import { useAppDict } from "@/content/i18n/app/provider"
import {
  formatDuration,
  formatLogDate,
  formatRetryIn,
  prettyBody,
} from "@/features/logs/log-format"
import { inboxHref } from "@/lib/inbox/inbox-tabs"
import { META_PAYMENT_SETTINGS_URL } from "@/lib/meta/whatsapp-billing-links"
import type { RequestLogDetail } from "@/lib/logs/read-model"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import {
  LogChannel,
  LogEndpoint,
  LogHttpCode,
  LogStatus,
} from "./log-badges"

// Sheet de detalle (mock `1n`): panel de 400 px **en línea**, hermano de la
// tabla —la comprime, no la tapa—. Mismos dos bloques para las tres
// direcciones, con la etiqueta que le toca a cada una. «Reintentar ahora» del
// mock queda para la v2 y por eso no se dibuja.

export function LogDetailSheet({
  detail,
  loading,
  clientName,
  relatedHref,
  onClose,
}: {
  /** `null` con `loading` apagado = el registro ya no existe. */
  detail: RequestLogDetail | null
  loading: boolean
  clientName: string | null
  relatedHref: string | null
  onClose: () => void
}) {
  const dict = useAppDict()
  const t = dict.requestLogs.detail

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-border-subtle bg-card shadow-[-12px_0_32px_-20px_rgba(0,0,0,0.18)]">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border-subtle pr-3 pl-[18px]">
        <h2 className="font-heading text-[15px] font-semibold">{t.title}</h2>
        <button
          type="button"
          onClick={onClose}
          title={t.close}
          aria-label={t.close}
          className="flex size-7 items-center justify-center rounded-[7px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {!detail ? (
        <p className="px-[18px] py-5 text-[13px] text-muted-foreground">
          {loading ? t.loading : t.notFound}
        </p>
      ) : (
        <>
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[18px] pt-4 pb-5",
              loading && "opacity-60"
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <LogStatus status={detail.status} pill />
              <LogHttpCode code={detail.httpStatus} />
              <LogChannel label={dict.channels.label[detail.channel]} />
              <span
                className="ml-auto font-mono text-[11px] text-[var(--text-subtle)]"
                suppressHydrationWarning
              >
                {formatLogDate(detail.createdAt, dict.intl)}
              </span>
            </div>

            <Callout detail={detail} />

            <dl className="grid grid-cols-[96px_1fr] text-[12.5px]">
              <Field label={t.fields.eventId} mono>
                {detail.eventId}
              </Field>
              <Field label={t.fields.direction}>
                {dict.requestLogs.directions[detail.direction]}
              </Field>
              <Field label={t.fields.eventType}>
                {t.eventTypes[detail.eventType] ?? detail.eventType}
              </Field>
              <Field label={t.fields.endpoint}>
                <LogEndpoint
                  method={detail.method}
                  endpoint={detail.endpoint}
                  wrap
                />
              </Field>
              <Field label={t.fields.account}>
                {detail.accountName && (
                  <>
                    {detail.accountName}{" "}
                    <span className="font-mono text-[10.5px] text-[var(--text-subtle)]">
                      {detail.accountExternalId}
                    </span>
                  </>
                )}
              </Field>
              <Field label={t.fields.client}>{clientName}</Field>
              <Field label={t.fields.contact} mono>
                {detail.contactId}
              </Field>
              <Field label={t.fields.providerId} mono>
                {detail.providerMessageId}
              </Field>
              <Field label={t.fields.requestId} mono>
                {detail.requestId}
              </Field>
              <Field label={t.fields.duration} mono>
                {detail.durationMs === null
                  ? null
                  : formatDuration(detail.durationMs)}
              </Field>
              <Field label={t.fields.attempts}>
                {detail.maxAttempts !== null && detail.attemptCount > 0
                  ? attemptsText(detail, t)
                  : null}
              </Field>
              <Field label={t.fields.signature}>
                {detail.signed === null ? null : detail.signed ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Check
                      className="size-3.5 text-success"
                      strokeWidth={2.2}
                      aria-hidden
                    />
                    {t.signed}
                  </span>
                ) : (
                  t.unsigned
                )}
              </Field>
            </dl>

            <BodyBlock
              label={dict.requestLogs.detail.requestLabel[detail.direction]}
              body={detail.requestBody}
              truncated={detail.requestTruncated}
              emptyText={t.noBody}
            />
            <BodyBlock
              label={dict.requestLogs.detail.responseLabel[detail.direction]}
              body={detail.responseBody}
              truncated={detail.responseTruncated}
              emptyText={
                detail.direction === "resender_to_bot" &&
                detail.status !== "skipped"
                  ? t.noResponse
                  : t.noBody
              }
            />
          </div>

          <div className="flex shrink-0 gap-2 border-t border-border-subtle px-[18px] py-3">
            {relatedHref && (
              <Button asChild variant="outline" className="h-[34px] flex-1">
                <Link href={relatedHref}>{t.viewRelated}</Link>
              </Button>
            )}
            {/* Solo si la conversación sigue existiendo: el log sobrevive 30
                días a lo que referencia. */}
            {detail.conversationId && detail.conversationExists && (
              <Button asChild variant="outline" className="h-[34px] flex-1">
                <Link
                  href={inboxHref({ conversationId: detail.conversationId })}
                >
                  {t.viewConversation}
                </Link>
              </Button>
            )}
          </div>
        </>
      )}
    </aside>
  )
}

type DetailDict = ReturnType<typeof useAppDict>["requestLogs"]["detail"]

function attemptsText(detail: RequestLogDetail, t: DetailDict): string {
  const base = t.attempts
    .replace("{attempt}", String(detail.attemptCount))
    .replace("{max}", String(detail.maxAttempts))
  if (detail.status !== "retrying" || !detail.nextRetryAt) return base
  const retryIn = formatRetryIn(detail.nextRetryAt, new Date())
  return `${base} · ${
    retryIn ? t.nextRetry.replace("{time}", retryIn) : t.nextRetrySoon
  }`
}

const WHATSAPP_PAYMENT_ERROR_CODE = "131042"

// Rojo para un fallo —con el código de Meta cuando lo hay—, ámbar mientras se
// reintenta y neutro para un omitido, que no es un error.
function Callout({ detail }: { detail: RequestLogDetail }) {
  const dict = useAppDict()
  const t = dict.requestLogs.detail
  if (detail.status === "skipped") {
    return (
      <p className="rounded-[10px] border border-border bg-surface-sunken px-3.5 py-3 text-[13px] text-text-secondary">
        {(detail.skipReason && t.skipReasons[detail.skipReason]) ??
          t.skipFallback}
      </p>
    )
  }
  if (!detail.errorMessage) return null
  const retrying = detail.status === "retrying"
  return (
    <p
      className={cn(
        "rounded-[10px] border px-3.5 py-3 text-[13px]",
        retrying
          ? "border-warning-soft-border bg-warning-soft text-warning-soft-foreground"
          : "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground"
      )}
    >
      {detail.errorCode && (
        <span className="font-mono font-bold">{detail.errorCode} </span>
      )}
      {detail.errorMessage}
      {/* 131042: el texto de Meta no dice qué hacer. Meta cobra directo a la
          tarjeta de la WABA (ADR 0023), así que la salida es suya y en Meta. */}
      {detail.errorCode === WHATSAPP_PAYMENT_ERROR_CODE && (
        <span className="mt-2 block">
          {dict.metaErrors.whatsappPaymentMethod}{" "}
          <a
            href={META_PAYMENT_SETTINGS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-4"
          >
            {dict.metaErrors.whatsappPaymentLink}
          </a>
        </span>
      )}
    </p>
  )
}

/** Una fila de la lista clave/valor. Sin valor, la fila no se dibuja. */
function Field({
  label,
  mono = false,
  children,
}: {
  label: string
  mono?: boolean
  children: ReactNode
}) {
  if (children === null || children === undefined || children === false) {
    return null
  }
  return (
    <>
      <dt className="border-b border-border-faint py-2 font-mono text-[11px] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 border-b border-border-faint py-2 break-words",
          mono && "font-mono text-[12px]"
        )}
      >
        {children}
      </dd>
    </>
  )
}

function BodyBlock({
  label,
  body,
  truncated,
  emptyText,
}: {
  label: string
  body: string | null
  truncated: boolean
  emptyText: string
}) {
  const t = useAppDict().requestLogs.detail
  const [copied, setCopied] = useState(false)
  const pretty = prettyBody(body)

  async function copy() {
    if (!pretty) return
    try {
      await navigator.clipboard.writeText(pretty)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Sin permiso de portapapeles no hay nada que hacer ni que romper.
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
        <span>
          {label}
          {truncated && ` · ${t.truncated}`}
        </span>
        {pretty && (
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 font-sans text-[11.5px] hover:text-foreground"
          >
            {copied ? t.copied : t.copy}
            {copied ? (
              <Check className="size-3" aria-hidden />
            ) : (
              <Copy className="size-3" aria-hidden />
            )}
          </button>
        )}
      </div>
      <pre
        className={cn(
          "max-h-[320px] overflow-auto rounded-[8px] border border-border bg-surface-sunken px-3.5 py-3 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap break-words",
          pretty ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {pretty ?? emptyText}
      </pre>
    </div>
  )
}

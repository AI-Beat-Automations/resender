import { ConnectFacebookButton } from "@/features/connect-meta/ui/connect-facebook-button"
import { ConnectInstagramButton } from "@/features/connect-meta/ui/connect-instagram-button"
import { ConnectWhatsAppButton } from "@/features/connect-whatsapp/ui/connect-whatsapp-button"
import { ChannelAvatar } from "@/features/connections/ui/channel-avatar"
import type { AppDict } from "@/content/i18n/app"

// B1: qué va a pasar al conectar la primera cuenta, y el flujo en tres pasos.
// Una tarjeta por canal: cada uno tiene su propio diálogo de autorización en
// Meta, así que son dos caminos y no dos variantes del mismo botón.
// Sin permiso, Instagram no aparece acá: es la pantalla que ve una cuenta
// nueva, que es justo la población que nace sin el canal (ADR 0010).
export function ConnectionsEmptyState({
  offersInstagram,
  offersWhatsapp,
  t,
}: {
  offersInstagram: boolean
  offersWhatsapp: boolean
  t: AppDict
}) {
  const steps = [
    t.connections.empty.step1,
    t.connections.empty.step2,
    t.connections.empty.step3,
  ]

  return (
    <>
      {/* Mock `1f`: tarjetas de canal en fila, CTA outline anclado abajo. Las
          columnas se auto-ajustan y no van fijas a tres: sin permiso de
          Instagram/WhatsApp solo hay una tarjeta y debe ocupar todo el ancho,
          no un tercio. */}
      <div className="grid gap-3.5 sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
        <ChannelCard
          channel="messenger"
          title={t.connections.empty.facebookTitle}
          body={t.connections.empty.facebookBody}
        >
          <ConnectFacebookButton
            label={t.connections.connectFacebook}
            variant="outline"
            size="default"
            className="mt-auto h-[34px] w-full"
          />
        </ChannelCard>

        {/* Sin permiso, Instagram no aparece acá: es la pantalla que ve una
            cuenta nueva, que es justo la población que nace sin el canal
            (ADR 0010). */}
        {offersInstagram && (
          <ChannelCard
            channel="instagram"
            title={t.connections.empty.instagramTitle}
            body={t.connections.empty.instagramBody}
          >
            <ConnectInstagramButton
              label={t.connections.connectInstagram}
              size="default"
              className="mt-auto h-[34px] w-full"
            />
          </ChannelCard>
        )}

        {offersWhatsapp && (
          <ChannelCard
            channel="whatsapp"
            title={t.connections.empty.whatsappTitle}
            body={t.connections.empty.whatsappBody}
          >
            <div className="mt-auto">
              <ConnectWhatsAppButton layout="card" />
            </div>
          </ChannelCard>
        )}
      </div>

      <section className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border-strong p-10 text-center">
        <div className="max-w-[440px]">
          <h2 className="font-heading text-[17px] font-semibold tracking-[-0.01em]">
            {t.connections.empty.title}
          </h2>
          <p className="mt-1.5 text-[13.5px]/[1.6] text-muted-foreground">
            {t.connections.empty.body}
          </p>
        </div>
        <ol className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
          {steps.map((step, index) => (
            <li
              key={step}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5"
            >
              <span className="font-mono text-foreground">{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

function ChannelCard({
  channel,
  title,
  body,
  children,
}: {
  channel: "messenger" | "instagram" | "whatsapp"
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-sm)]">
      <ChannelAvatar channel={channel} />
      <div>
        <h2 className="font-heading text-[15px] font-semibold">{title}</h2>
        <p className="mt-1 text-[13px]/[1.5] text-muted-foreground">{body}</p>
      </div>
      {children}
    </section>
  )
}

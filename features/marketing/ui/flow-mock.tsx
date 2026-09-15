"use client"

import * as React from "react"
import Image from "next/image"

import { cn } from "@/lib/utils"

import { getDictionary, type Locale } from "@/content/i18n"

// Animación del hero: un mensaje entra por WhatsApp / Instagram / Facebook,
// Resender lo procesa (con las herramientas que se conectan al webhook) y la
// respuesta vuelve por el mismo canal. Sigue el frame "2a" del mock
// `Mensaje entra y sale.dc.html`: burbujas flotando sobre el fondo, sin tarjeta.
//
// Se reproduce UNA sola vez cuando entra en viewport y queda estática con todo
// visible. Con `prefers-reduced-motion` (o sin JS) se muestra directamente el
// estado final. Los delays viven acá y no en CSS para leer la secuencia entera
// de un vistazo.

const CHANNELS = [
  { src: "/brands/whatsapp.svg", alt: "WhatsApp" },
  { src: "/brands/instagram.svg", alt: "Instagram" },
  { src: "/brands/facebook.svg", alt: "Facebook" },
] as const

const TOOLS = [
  { src: "/brands/n8n.svg", alt: "n8n" },
  { src: "/brands/make.svg", alt: "Make" },
  { src: "/brands/zapier.svg", alt: "Zapier" },
  { src: "/brands/claude.svg", alt: "Claude" },
] as const

// Línea de tiempo (ms). Cada valor es el inicio de la animación del elemento.
const T = {
  inBubble: 0,
  inAvatars: 400,
  node: 1800,
  tools: 2200,
  outBubble: 3800,
  outAvatars: 4200,
} as const
const STAGGER = 150

type Phase = "static" | "armed" | "playing"

function useAnim(phase: Phase) {
  // `static`: todo visible sin animar (SSR, sin JS o reduced-motion).
  // `armed`: montado pero todavía fuera de viewport → oculto, esperando.
  // `playing`: corre la secuencia una vez; `both` deja el estado final.
  const pop = (delay: number): React.CSSProperties | undefined => {
    if (phase === "static") return undefined
    if (phase === "armed") return { opacity: 0 }
    return { animation: `msg-pop 400ms ease-out ${delay}ms both` }
  }
  return { pop }
}

function Avatars({ phase, delay }: { phase: Phase; delay: number }) {
  const { pop } = useAnim(phase)
  return (
    <div className="flex items-center">
      {CHANNELS.map((c, i) => (
        <span
          key={c.alt}
          className={cn(
            // Sin anillo ni relleno: los badges se solapan a ras, como en el mock.
            // `overflow-hidden` recorta el cuadrado de Instagram en círculo.
            "relative inline-flex size-5 items-center justify-center overflow-hidden rounded-full",
            i > 0 && "-ml-1.5"
          )}
          style={{ zIndex: CHANNELS.length - i, ...pop(delay + i * STAGGER) }}
        >
          <Image src={c.src} alt={c.alt} width={20} height={20} />
        </span>
      ))}
    </div>
  )
}

function Bubble({
  side,
  meta,
  text,
  phase,
  delay,
  avatarsDelay,
}: {
  side: "in" | "out"
  meta: string
  text: string
  phase: Phase
  delay: number
  avatarsDelay: number
}) {
  const { pop } = useAnim(phase)
  return (
    <div
      className={cn(
        "flex w-[min(100%,22rem)] flex-col gap-3 bg-card px-6 py-5 shadow-[0_10px_30px_-12px_rgba(36,32,41,0.18),0_2px_6px_rgba(36,32,41,0.05)] dark:shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)]",
        side === "in"
          ? "self-start rounded-[26px] rounded-bl-[6px]"
          : "self-end rounded-[26px] rounded-br-[6px]"
      )}
      style={pop(delay)}
    >
      <div className="flex items-center gap-2.5">
        <Avatars phase={phase} delay={avatarsDelay} />
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {meta}
        </span>
      </div>
      <div
        className={cn(
          "text-[17px] leading-[1.45] text-foreground",
          side === "out" && "font-medium"
        )}
      >
        {text}
      </div>
    </div>
  )
}

export function FlowMock({ lang }: { lang: Locale }) {
  const { flowMock } = getDictionary(lang)
  const ref = React.useRef<HTMLDivElement>(null)
  const [phase, setPhase] = React.useState<Phase>("static")
  const { pop } = useAnim(phase)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    // Oculta y espera al viewport. Se activa solo en cliente: evita mismatch
    // SSR y deja el estado final en el HTML servido. Intencional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase("armed")
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase("playing")
          io.disconnect()
        }
      },
      { threshold: 0.35 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className="flex flex-col">
      <Bubble
        side="in"
        meta={flowMock.in.meta}
        text={flowMock.in.text}
        phase={phase}
        delay={T.inBubble}
        avatarsDelay={T.inAvatars}
      />

      {/* Nodo central: "Resender procesa" + herramientas. */}
      <div className="my-8 flex flex-col items-center">
        <div className="flex flex-col items-center gap-2.5" style={pop(T.node)}>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-2 rounded-full bg-warning",
                phase === "playing" &&
                  "animate-[connector-pulse_1.4s_ease-in-out_infinite]"
              )}
            />
            <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-warning-text uppercase">
              {flowMock.hook.text}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {TOOLS.map((t, i) => (
              <span
                key={t.alt}
                className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-card"
                style={pop(T.tools + i * STAGGER)}
              >
                <Image src={t.src} alt={t.alt} width={18} height={18} />
              </span>
            ))}
          </div>
        </div>
      </div>

      <Bubble
        side="out"
        meta={flowMock.out.meta}
        text={flowMock.out.text}
        phase={phase}
        delay={T.outBubble}
        avatarsDelay={T.outAvatars}
      />
    </div>
  )
}

"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import { getDictionary, type Locale } from "@/content/i18n"

// Timeline animado del recorrido de un mensaje (diseño 1b), en claro y oscuro.
// Secuencia en loop: aparece el paso IN → se pinta la línea → aparece HOOK →
// se pinta la línea → aparece OUT. El contenedor se remonta por ciclo.
//
// Los labels IN/HOOK/OUT quedan fijos (son tokens, no copy); el meta y el texto
// de cada paso salen del diccionario.

type FlowStep = {
  label: string
  labelClass: string
  meta: string
  text: string
  textClass: string
  dotClass: string
  delay: number
  lineDelay: number | null
}

function buildSteps(lang: Locale): FlowStep[] {
  const { flowMock } = getDictionary(lang)
  return [
    {
      label: "IN",
      labelClass: "text-primary",
      meta: flowMock.in.meta,
      text: flowMock.in.text,
      textClass: "text-foreground",
      dotClass: "bg-primary",
      delay: 300,
      lineDelay: 900,
    },
    {
      label: "HOOK",
      labelClass: "text-muted-foreground",
      meta: flowMock.hook.meta,
      text: flowMock.hook.text,
      textClass: "text-sm text-muted-foreground",
      dotClass: "box-border border-2 border-primary bg-card",
      delay: 1500,
      lineDelay: 2100,
    },
    {
      label: "OUT",
      labelClass: "text-foreground",
      meta: flowMock.out.meta,
      text: flowMock.out.text,
      textClass: "font-medium text-foreground",
      dotClass: "bg-foreground",
      delay: 2700,
      lineDelay: null,
    },
  ]
}

const CYCLE = 5200

function Sequence({ steps, animate }: { steps: FlowStep[]; animate: boolean }) {
  const fade = (delay: number): React.CSSProperties | undefined =>
    animate
      ? { animation: `node-pop 350ms ease-out ${delay}ms both` }
      : undefined

  const draw = (delay: number): React.CSSProperties =>
    animate
      ? {
          transformOrigin: "top",
          animation: `connector-draw 450ms ease-out ${delay}ms both`,
        }
      : {}

  return (
    <div className="flex flex-col">
      {steps.map((step) => (
        <div key={step.label} className="flex gap-4">
          {/* Columna del nodo: punto + línea conectora que se pinta. */}
          <div className="flex flex-col items-center">
            <span
              className={cn("mt-1 size-2.5 rounded-full", step.dotClass)}
              style={fade(step.delay)}
            />
            {step.lineDelay !== null ? (
              <span
                className="w-px flex-1 bg-border"
                style={draw(step.lineDelay)}
              />
            ) : null}
          </div>
          {/* Contenido del paso. */}
          <div
            className={cn(step.lineDelay !== null && "pb-6")}
            style={fade(step.delay)}
          >
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "font-mono text-[11px] font-semibold",
                  step.labelClass
                )}
              >
                {step.label}
              </span>
              <span className="text-xs text-muted-foreground">{step.meta}</span>
            </div>
            <div className={cn("mt-1 text-[15px]", step.textClass)}>
              {step.text}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function FlowMock({ lang }: { lang: Locale }) {
  const [cycle, setCycle] = React.useState(0)
  const [animate, setAnimate] = React.useState(false)

  const dict = getDictionary(lang)
  const steps = React.useMemo(() => buildSteps(lang), [lang])

  React.useEffect(() => {
    // Activa animaciones solo en cliente (evita mismatch SSR). Intencional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnimate(true)
    const id = setInterval(() => setCycle((c) => c + 1), CYCLE)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="rounded-3xl border border-border bg-card p-7 shadow-sm">
      <div className="mb-6 font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
        {dict.flowMock.live}
      </div>
      {/* key={cycle}: remonta la secuencia para reproducir la animación en loop. */}
      <Sequence key={cycle} steps={steps} animate={animate} />
    </div>
  )
}

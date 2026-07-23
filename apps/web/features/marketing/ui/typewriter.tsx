"use client"

import * as React from "react"

// Tipea el texto una sola vez al cargar la página (efecto máquina de escribir).
// Con prefers-reduced-motion muestra el texto completo de una. El caret que
// parpadea va aparte, en el hero, justo después de este componente.
export function Typewriter({
  text,
  className,
  speed = 60,
}: {
  text: string
  className?: string
  speed?: number
}) {
  const [count, setCount] = React.useState(0)

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCount(text.length)
      return
    }
    const id = setInterval(() => {
      setCount((c) => {
        if (c >= text.length) {
          clearInterval(id)
          return c
        }
        return c + 1
      })
    }, speed)
    return () => clearInterval(id)
  }, [text, speed])

  return <span className={className}>{text.slice(0, count)}</span>
}

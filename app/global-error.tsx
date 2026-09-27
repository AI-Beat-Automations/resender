"use client"

import * as Sentry from "@sentry/nextjs"
import NextError from "next/error"
import { useEffect } from "react"

// Reemplaza al root layout cuando el error ocurre en él (o en algo que ningún
// `error.tsx` atrapa), así que tiene que dibujar su propio `<html>`. Los
// errores de render del cliente solo llegan a Sentry por acá: `onRequestError`
// de `instrumentation.ts` cubre los del servidor.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="es">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  )
}

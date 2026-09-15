"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

// El redirect de éxito de Checkout puede llegar antes que el webhook que abre
// el acceso: refresca el server component cada pocos segundos hasta que el
// gate vea la suscripción y redirija al producto.
export function ActivationPoller() {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 2000)
    return () => clearInterval(id)
  }, [router])

  return null
}

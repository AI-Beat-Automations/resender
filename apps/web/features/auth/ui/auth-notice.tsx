import type { ReactNode } from "react"
import { Check, TriangleAlert } from "lucide-react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"

// El cuadro de error/éxito que comparten los formularios de acceso, sobre el
// `Alert` del DS. `Alert` ya pone `role="alert"`; el éxito de «te enviamos el
// correo» es un `status` (no interrumpe al lector de pantalla) y lo pasa quien
// lo dibuja. Sin hooks: lo usan client y server components.
export function AuthNotice({
  tone,
  title,
  role,
  children,
}: {
  tone: "error" | "success"
  title?: string
  role?: "alert" | "status"
  children: ReactNode
}) {
  const Icon = tone === "error" ? TriangleAlert : Check
  const resolvedRole = role ?? (tone === "error" ? "alert" : "status")

  return (
    <Alert
      variant={tone === "error" ? "destructive" : "success"}
      role={resolvedRole}
      aria-live={resolvedRole === "status" ? "polite" : undefined}
      className="text-[13px]"
    >
      <Icon className="size-3.5" aria-hidden />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription className="text-[13px]">{children}</AlertDescription>
    </Alert>
  )
}

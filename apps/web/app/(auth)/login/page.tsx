import { redirect } from "next/navigation"
import { Check } from "lucide-react"

import { auth } from "@/auth"
import { loginAction } from "@/features/auth/actions"
import {
  AccessCard,
  AccessDocsLink,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import { AuthForm } from "@/features/auth/ui/auth-form"

type LoginPageProps = {
  searchParams: Promise<{ passwordChanged?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, params] = await Promise.all([auth(), searchParams])
  if (session?.user?.id) redirect("/connections")

  // `changePasswordAction` cierra la sesión y vuelve aquí con este parámetro:
  // sin el aviso, el usuario aterriza en un login que no pidió.
  const passwordChanged = params.passwordChanged === "1"

  return (
    <AccessShell topbarEnd={<AccessDocsLink />}>
      <AccessCard className="max-w-100">
        <AccessEyebrow label="acceso" />
        <h1 className="mt-1.5 font-heading text-2xl font-bold tracking-tight">
          Iniciar sesión.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Entra para administrar tus conexiones y el log de mensajes.
        </p>
        {passwordChanged ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-success-soft-border bg-success-soft px-3 py-2.5 text-[13px] text-success-soft-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Contraseña actualizada. Inicia sesión con la nueva.
          </p>
        ) : null}
        <AuthForm action={loginAction} mode="login" />
      </AccessCard>
    </AccessShell>
  )
}

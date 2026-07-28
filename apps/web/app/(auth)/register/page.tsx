import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { registerAction } from "@/features/auth/actions"
import {
  AccessCard,
  AccessDocsLink,
  AccessEyebrow,
  AccessShell,
} from "@/features/auth/ui/access-shell"
import { AuthForm } from "@/features/auth/ui/auth-form"

export default async function RegisterPage() {
  const session = await auth()
  if (session?.user?.id) redirect("/connections")

  return (
    <AccessShell topbarEnd={<AccessDocsLink />}>
      <AccessCard className="max-w-95 p-6.5">
        <AccessEyebrow label="alta" />
        <h1 className="mt-1.5 font-heading text-[22px] font-bold tracking-tight">
          Crear cuenta.
        </h1>
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          Email y contraseña. No hay verificación por correo en el MVP.
        </p>
        <AuthForm action={registerAction} mode="register" />
      </AccessCard>
    </AccessShell>
  )
}

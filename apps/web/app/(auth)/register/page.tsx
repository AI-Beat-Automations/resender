import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { registerAction } from "@/features/auth/actions"
import { AuthForm } from "@/features/auth/ui/auth-form"

export default async function RegisterPage() {
  const session = await auth()
  if (session?.user?.id) redirect("/connections")

  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Register</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Crea una cuenta con email y password. No hay verificacion de email
            en el MVP.
          </p>
        </div>
        <AuthForm action={registerAction} mode="register" />
      </div>
    </main>
  )
}

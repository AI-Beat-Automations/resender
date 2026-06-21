import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { SiteFooter } from "@/components/site-footer"
import { loginAction } from "@/features/auth/actions"
import { AuthForm } from "@/features/auth/ui/auth-form"

type LoginPageProps = {
  searchParams: Promise<{ passwordChanged?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, params] = await Promise.all([auth(), searchParams])
  if (session?.user?.id) redirect("/connections")

  const passwordChanged = params.passwordChanged === "1"

  return (
    <div className="flex min-h-svh flex-col">
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">Login</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Entra para administrar tus conexiones y bitacora.
            </p>
          </div>
          {passwordChanged ? (
            <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-100">
              Password actualizado. Inicia sesion con tu nueva contrasena.
            </p>
          ) : null}
          <AuthForm action={loginAction} mode="login" />
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

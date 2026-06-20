import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { SiteFooter } from "@/components/site-footer"
import { loginAction } from "@/features/auth/actions"
import { AuthForm } from "@/features/auth/ui/auth-form"

export default async function LoginPage() {
  const session = await auth()
  if (session?.user?.id) redirect("/connections")

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
          <AuthForm action={loginAction} mode="login" />
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

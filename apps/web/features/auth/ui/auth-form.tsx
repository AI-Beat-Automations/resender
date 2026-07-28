"use client"

import Link from "next/link"
import { useActionState } from "react"
import { LoaderCircle, TriangleAlert } from "lucide-react"

import type { AuthFormState } from "@/features/auth/actions"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

type AuthAction = (
  state: AuthFormState,
  formData: FormData
) => Promise<AuthFormState>

type AuthFormProps = {
  action: AuthAction
  mode: "login" | "register"
}

export function AuthForm({ action, mode }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, {})
  const isLogin = mode === "login"
  const hasError = Boolean(state.error)

  return (
    <>
      <form action={formAction} className="mt-5 flex flex-col gap-3.5">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={pending}
            aria-invalid={hasError}
            placeholder="tu@empresa.com"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            minLength={8}
            disabled={pending}
            aria-invalid={hasError}
            aria-describedby={isLogin ? undefined : "password-hint"}
            placeholder={isLogin ? undefined : "Al menos 8 caracteres"}
          />
          {/* El mínimo de contraseña se anuncia antes de enviar, no como error
              del servidor: en el alta es un requisito, no un fallo. */}
          {!isLogin && (
            <p id="password-hint" className="text-[13px] text-muted-foreground">
              Al menos 8 caracteres.
            </p>
          )}
        </div>
        {state.error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive-soft-border bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive-soft-foreground"
          >
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {state.error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              Procesando…
            </>
          ) : isLogin ? (
            "Entrar"
          ) : (
            "Crear cuenta"
          )}
        </Button>
      </form>
      <p className="mt-4 text-center text-[13.5px] text-muted-foreground">
        {isLogin ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}
        <Link
          href={isLogin ? "/register" : "/login"}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {isLogin ? "Crear una" : "Iniciar sesión"}
        </Link>
      </p>
    </>
  )
}

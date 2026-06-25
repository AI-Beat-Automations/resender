"use client"

import Link from "next/link"
import { useActionState } from "react"

import type { AuthFormState } from "@/features/auth/actions"
import { Button } from "@workspace/ui/components/button"

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

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          placeholder="you@company.com"
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          required
          minLength={8}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          placeholder="At least 8 characters"
        />
      </div>
      {state.error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Processing..." : isLogin ? "Sign in" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {isLogin ? "Don't have an account?" : "Already have an account?"} {" "}
        <Link
          href={isLogin ? "/register" : "/login"}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {isLogin ? "Sign up" : "Sign in"}
        </Link>
      </p>
    </form>
  )
}

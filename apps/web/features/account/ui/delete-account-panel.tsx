"use client"

import { useActionState } from "react"

import {
  deleteAccountAction,
  type DeleteAccountState,
} from "@/features/account/actions"
import { Button } from "@workspace/ui/components/button"

export function DeleteAccountPanel({ email }: { email: string }) {
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(
    deleteAccountAction,
    {}
  )

  return (
    <section className="rounded-2xl border border-destructive/40 bg-card p-6 shadow-sm">
      <h2 className="font-medium text-destructive">Delete account</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Permanently deletes your account and all your data: connected Pages,
        conversations, messages, and API keys. Before deleting, we attempt to
        unsubscribe your Pages from Meta&apos;s webhook. This action is immediate
        and can&apos;t be undone; backups are purged within 30 days.
      </p>
      <form
        action={action}
        onSubmit={(event) => {
          const ok = window.confirm(
            "This permanently deletes your account and all your data. Continue?"
          )
          if (!ok) event.preventDefault()
        }}
        className="mt-4 grid gap-3 sm:max-w-md"
      >
        <label className="text-sm font-medium" htmlFor="confirmEmail">
          Type <span className="font-mono">{email}</span> to confirm
        </label>
        <input
          id="confirmEmail"
          name="confirmEmail"
          type="email"
          autoComplete="off"
          required
          placeholder={email}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        />
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Deleting..." : "Delete account"}
        </Button>
        {state.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
      </form>
    </section>
  )
}

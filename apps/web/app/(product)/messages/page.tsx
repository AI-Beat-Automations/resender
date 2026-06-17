export default function MessagesPage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Messages</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          La bitacora persistente por conversaciones se implementa en el corte
          de Messages del stack.
        </p>
      </div>
      <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
        Todavia no hay conversaciones persistidas para mostrar.
      </section>
    </div>
  )
}

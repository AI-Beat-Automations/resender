export default function SettingsPage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Administra tu cuenta y las API keys de integracion externa.
        </p>
      </div>
      <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
        La gestion de API keys llega en el siguiente corte dedicado de Settings.
      </section>
    </div>
  )
}

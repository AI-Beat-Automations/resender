import Link from "next/link"
import { redirect } from "next/navigation"
import { Clock3 } from "lucide-react"

import { auth, signOut } from "@/auth"
import { AccessCard, AccessShell } from "@/features/auth/ui/access-shell"
import { isUserWaitlisted } from "@/lib/auth/waitlist"
import { Button } from "@workspace/ui/components/button"

// Aterrizaje de las cuentas que se registraron con el producto cerrado.
// Vive fuera del grupo `(product)` a propósito: ese layout rebota aquí a los
// usuarios en lista de espera, así que esta página no puede ir envuelta por él.
export default async function WaitlistPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  if (!(await isUserWaitlisted(session.user.id))) redirect("/connections")

  return (
    <AccessShell
      topbarEnd={
        <form
          action={async () => {
            "use server"
            await signOut({ redirectTo: "/" })
          }}
        >
          <Button type="submit" variant="outline">
            Cerrar sesión
          </Button>
        </form>
      }
    >
      <AccessCard className="max-w-130 p-7.5">
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Clock3 className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4.5 font-heading text-[22px] font-bold tracking-tight">
          Estás en la lista de espera.
        </h1>
        <p className="mt-2.5 text-[14.5px]/[1.6] text-muted-foreground">
          Tu cuenta ya está creada y tu lugar guardado. Estamos abriendo el
          acceso de a poco y te escribimos en cuanto te toque.
        </p>
        <div className="mt-4.5 rounded-lg border border-border bg-surface-sunken px-3.5 py-3">
          <p className="text-[12.5px] text-muted-foreground">Te escribimos a</p>
          <p className="mt-0.5 font-mono text-[13.5px]">{session.user.email}</p>
        </div>
        <p className="mt-4 text-[13px]/[1.6] text-muted-foreground">
          Mientras tanto puedes leer la{" "}
          <Link
            href="/docs"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            documentación
          </Link>{" "}
          o escribirnos a{" "}
          <a
            href="mailto:info@resender.dev"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            info@resender.dev
          </a>
          .
        </p>
      </AccessCard>
    </AccessShell>
  )
}

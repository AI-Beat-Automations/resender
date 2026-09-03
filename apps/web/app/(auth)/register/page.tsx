import { getDictionary } from "@/content/i18n"
import { RegisterView } from "@/features/auth/ui/register-view"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata(
  getDictionary("es").auth.register.title
)

type RegisterPageProps = {
  searchParams: Promise<{ error?: string }>
}

// `error` es el rebote del flujo de Google (`errorCallbackURL`), crudo: lo
// clasifica la vista.
export default async function RegisterPage({
  searchParams,
}: RegisterPageProps) {
  const params = await searchParams
  return <RegisterView lang="es" oauthError={params.error} />
}

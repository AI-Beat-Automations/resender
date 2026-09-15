import { getDictionary } from "@/content/i18n"
import { LoginView } from "@/features/auth/ui/login-view"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata(
  getDictionary("es").auth.login.title
)

type LoginPageProps = {
  searchParams: Promise<{ passwordChanged?: string; error?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams

  // `changePasswordAction` cierra la sesión y vuelve aquí con este parámetro:
  // sin el aviso, el usuario aterriza en un login que no pidió. `error` es el
  // rebote del flujo de Google (`errorCallbackURL`), crudo: lo clasifica la
  // vista.
  return (
    <LoginView
      lang="es"
      passwordChanged={params.passwordChanged === "1"}
      oauthError={params.error}
    />
  )
}

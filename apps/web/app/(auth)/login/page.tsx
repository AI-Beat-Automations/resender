import { LoginView } from "@/features/auth/ui/login-view"
import { getDictionary } from "@/content/i18n"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata(getDictionary("es").auth.login.title)

type LoginPageProps = {
  searchParams: Promise<{ passwordChanged?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  return <LoginView lang="es" passwordChanged={params.passwordChanged === "1"} />
}

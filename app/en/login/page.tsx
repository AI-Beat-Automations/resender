import { LoginView } from "@/features/auth/ui/login-view"
import { getDictionary } from "@/content/i18n"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata(
  getDictionary("en").auth.login.title
)

type LoginPageProps = {
  searchParams: Promise<{ passwordChanged?: string; error?: string }>
}

export default async function EnLoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  return (
    <LoginView
      lang="en"
      passwordChanged={params.passwordChanged === "1"}
      oauthError={params.error}
    />
  )
}

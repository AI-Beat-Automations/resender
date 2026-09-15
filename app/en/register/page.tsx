import { RegisterView } from "@/features/auth/ui/register-view"
import { getDictionary } from "@/content/i18n"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata(
  getDictionary("en").auth.register.title
)

type RegisterPageProps = {
  searchParams: Promise<{ error?: string }>
}

export default async function EnRegisterPage({
  searchParams,
}: RegisterPageProps) {
  const params = await searchParams
  return <RegisterView lang="en" oauthError={params.error} />
}

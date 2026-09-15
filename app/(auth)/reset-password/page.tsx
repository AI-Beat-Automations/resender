import { getDictionary } from "@/content/i18n"
import { ResetPasswordView } from "@/features/auth/ui/reset-password-view"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata(
  getDictionary("es").auth.reset.title
)

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams
  return <ResetPasswordView lang="es" token={params.token ?? ""} />
}

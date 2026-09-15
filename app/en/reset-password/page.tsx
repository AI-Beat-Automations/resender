import { getDictionary } from "@/content/i18n"
import { ResetPasswordView } from "@/features/auth/ui/reset-password-view"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata(
  getDictionary("en").auth.reset.title
)

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>
}

export default async function EnResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams
  return <ResetPasswordView lang="en" token={params.token ?? ""} />
}

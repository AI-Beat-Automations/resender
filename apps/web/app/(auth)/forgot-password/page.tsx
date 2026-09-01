import { getDictionary } from "@/content/i18n"
import { ForgotPasswordView } from "@/features/auth/ui/forgot-password-view"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata(
  getDictionary("es").auth.forgot.title
)

export default function ForgotPasswordPage() {
  return <ForgotPasswordView lang="es" />
}

import { getDictionary } from "@/content/i18n"
import { ForgotPasswordView } from "@/features/auth/ui/forgot-password-view"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata(
  getDictionary("en").auth.forgot.title
)

export default function EnForgotPasswordPage() {
  return <ForgotPasswordView lang="en" />
}

import { RegisterView } from "@/features/auth/ui/register-view"
import { getDictionary } from "@/content/i18n"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata(
  getDictionary("en").auth.register.title
)

export default function EnRegisterPage() {
  return <RegisterView lang="en" />
}

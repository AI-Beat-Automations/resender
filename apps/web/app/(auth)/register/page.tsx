import { getDictionary } from "@/content/i18n"
import { RegisterView } from "@/features/auth/ui/register-view"
import { privatePageMetadata } from "@/lib/seo"

export const metadata = privatePageMetadata(
  getDictionary("es").auth.register.title
)

export default function RegisterPage() {
  return <RegisterView lang="es" />
}

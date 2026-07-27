import { LoginView } from "@/features/auth/ui/login-view"

type LoginPageProps = {
  searchParams: Promise<{ passwordChanged?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  return <LoginView lang="es" passwordChanged={params.passwordChanged === "1"} />
}

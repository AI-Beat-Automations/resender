import { LoginView } from "@/features/auth/ui/login-view"

type LoginPageProps = {
  searchParams: Promise<{ passwordChanged?: string }>
}

export default async function EnLoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  return <LoginView lang="en" passwordChanged={params.passwordChanged === "1"} />
}

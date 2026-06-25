import { Button } from "@workspace/ui/components/button"

// Flujo de redirección: el botón solo navega al endpoint que arranca el OAuth de
// Meta (genera el state CSRF y redirige al diálogo). Ya no usa el JS SDK /
// FB.login, así que es un server component sin estado de cliente.
export function ConnectFacebookButton() {
  return (
    <Button asChild>
      <a href="/api/meta/start">Connect Facebook</a>
    </Button>
  )
}

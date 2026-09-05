"use client"

import { useActionState } from "react"
import { LoaderCircle } from "lucide-react"

import { signInWithGoogleAction } from "@/features/auth/actions"
import { getDictionary, type Locale } from "@/content/i18n"
import { AuthNotice } from "@/features/auth/ui/auth-notice"
import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"

// «Continuar con Google» más el separador «o» que lo aparta del `AuthForm`
// de siempre ([Cuenta vinculada], issue #98). Es un form con server action y
// **no** un `authClient.signIn.social()`: el repositorio no tiene cliente de
// Better Auth y el flujo social entero se sostiene en server actions.
//
// Quién lo dibuja lo decide el server component (`login-view`,
// `register-view`) con `isGoogleEnabled()`: este componente no lee
// `process.env` ni sabe si Google existe.
export function GoogleSignIn({
  lang,
  from,
}: {
  lang: Locale
  from: "login" | "register"
}) {
  const [state, formAction, pending] = useActionState(
    signInWithGoogleAction,
    {}
  )
  const t = getDictionary(lang).auth

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        {/* Los dos inputs ocultos son lo que el action no puede ver: el idioma
            de la página (para el 429 y para el prefijo `/en`) y desde qué
            pantalla salió, que es a dónde vuelve el `?error=`. */}
        <input type="hidden" name="locale" value={lang} />
        <input type="hidden" name="from" value={from} />
        {state.error && <AuthNotice tone="error">{state.error}</AuthNotice>}
        <Button
          type="submit"
          size="lg"
          variant="outline"
          className="w-full"
          disabled={pending}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <GoogleMark />
          )}
          {t.google.continueWith}
        </Button>
      </form>
      {/* Separador «o»: un `Separator` a cada lado y la palabra en el medio,
          con el mismo tono apagado del texto secundario de la card. */}
      <div
        className="flex items-center gap-2.5 text-[12px] text-muted-foreground"
        aria-hidden
      >
        <Separator className="flex-1" />
        <span>{t.google.divider}</span>
        <Separator className="flex-1" />
      </div>
    </>
  )
}

// La «G» de Google en SVG inline, sin dependencia nueva. Cuatro trazos con
// los colores de marca; decorativa, el texto del botón ya dice «Google».
function GoogleMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      aria-hidden
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29A11.97 11.97 0 0 0 0 12c0 1.94.46 3.77 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  )
}

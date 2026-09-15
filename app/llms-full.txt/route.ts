import { llmsFullTxtResponse } from "@/lib/llms-txt"

export const dynamic = "force-static"

// Volcado del contenido completo del sitio en español, referenciado desde la
// sección "Optional" de /llms.txt.
export function GET() {
  return llmsFullTxtResponse("es")
}

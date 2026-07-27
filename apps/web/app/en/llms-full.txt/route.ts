import { llmsFullTxtResponse } from "@/lib/llms-txt"

export const dynamic = "force-static"

// Volcado del contenido completo del sitio en inglés.
export function GET() {
  return llmsFullTxtResponse("en")
}

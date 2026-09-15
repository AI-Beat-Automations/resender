import { llmsTxtResponse } from "@/lib/llms-txt"

// Prerenderizado en build: el worker no tiene los .md del blog en su filesystem,
// así que en runtime el índice saldría sin posts (mismo motivo que el RSS).
export const dynamic = "force-static"

// Índice para LLMs en español (spec: https://llmstxt.org/). El de inglés vive en
// /en/llms.txt y el volcado completo en /llms-full.txt.
export function GET() {
  return llmsTxtResponse("es")
}

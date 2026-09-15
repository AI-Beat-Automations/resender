import { llmsTxtResponse } from "@/lib/llms-txt"

export const dynamic = "force-static"

// Índice para LLMs en inglés. Gemelo de /llms.txt; cada uno enlaza al otro desde
// su sección "Optional".
export function GET() {
  return llmsTxtResponse("en")
}

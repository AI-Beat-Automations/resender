import { Check, X } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { Section, SectionHeading } from "@/features/marketing/ui/section"
import { getDictionary, type Locale } from "@/content/i18n"

function Cell({
  value,
  yes,
  no,
}: {
  value: string | boolean
  yes: string
  no: string
}) {
  if (value === true) {
    return <Check className="mx-auto size-5 text-success" aria-label={yes} />
  }
  if (value === false) {
    return (
      <X className="mx-auto size-5 text-muted-foreground/50" aria-label={no} />
    )
  }
  return <span>{value}</span>
}

export function ComparisonTable({ lang }: { lang: Locale }) {
  const { comparison } = getDictionary(lang)

  return (
    <Section tone="muted">
      <SectionHeading
        kicker={comparison.kicker}
        title={comparison.title}
        subtitle={comparison.subtitle}
      />
      {/* La tabla va dentro de una tarjeta con bordes redondos (mock `1m`); la
          cabecera en mono mayúscula, con Resender en `foreground` y ManyChat
          apagado. */}
      <div className="mx-auto mt-12 max-w-3xl overflow-x-auto rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-1/2 px-5 font-mono text-[11px] tracking-[0.06em] uppercase">
                {comparison.headers.feature}
              </TableHead>
              <TableHead className="text-center font-mono text-[11px] font-semibold tracking-[0.06em] text-foreground uppercase">
                {comparison.headers.resender}
              </TableHead>
              <TableHead className="text-center font-mono text-[11px] tracking-[0.06em] uppercase">
                {comparison.headers.manychat}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.rows.map((row) => (
              <TableRow key={row.feature} className="last:border-0">
                <TableCell className="px-5 py-3.5">{row.feature}</TableCell>
                <TableCell className="text-center font-medium">
                  <Cell
                    value={row.resender}
                    yes={comparison.yes}
                    no={comparison.no}
                  />
                </TableCell>
                <TableCell className="text-center text-muted-foreground">
                  <Cell
                    value={row.manychat}
                    yes={comparison.yes}
                    no={comparison.no}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  )
}

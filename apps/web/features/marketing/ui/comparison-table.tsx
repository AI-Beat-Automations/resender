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
    return <Check className="mx-auto size-5 text-primary" aria-label={yes} />
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
      <div className="mx-auto mt-12 max-w-3xl overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/2">
                {comparison.headers.feature}
              </TableHead>
              <TableHead className="text-center font-semibold text-primary">
                {comparison.headers.resender}
              </TableHead>
              <TableHead className="text-center">
                {comparison.headers.manychat}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.rows.map((row) => (
              <TableRow key={row.feature}>
                <TableCell className="font-medium">{row.feature}</TableCell>
                <TableCell className="text-center">
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

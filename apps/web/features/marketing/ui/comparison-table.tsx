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
import { dict } from "@/content/i18n/es"

function Cell({ value }: { value: string | boolean }) {
  if (value === true) {
    return <Check className="mx-auto size-5 text-primary" aria-label="Sí" />
  }
  if (value === false) {
    return <X className="mx-auto size-5 text-muted-foreground/50" aria-label="No" />
  }
  return <span>{value}</span>
}

export function ComparisonTable() {
  const { comparison } = dict
  return (
    <Section tone="muted">
      <SectionHeading
        kicker="vs manychat"
        title={comparison.title}
        subtitle={comparison.subtitle}
      />
      <div className="mx-auto mt-12 max-w-3xl overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/2">{comparison.headers.feature}</TableHead>
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
                  <Cell value={row.resender} />
                </TableCell>
                <TableCell className="text-center text-muted-foreground">
                  <Cell value={row.manychat} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  )
}

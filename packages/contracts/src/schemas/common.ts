import { z } from "zod"

import { ERROR_CODES } from "../errors"

export const IsoDateSchema = z.iso.datetime({ offset: true })
export const UuidSchema = z.uuid()
export const CursorSchema = z.string().min(1).max(2000)
export const LimitSchema = z.coerce.number().int().min(1).max(100).default(25)

export const PaginationSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
})

export const RequestIdHeaderSchema = z.object({
  "X-Request-Id": z.string(),
})

export const ErrorDetailSchema = z.object({
  path: z.string().optional(),
  message: z.string(),
  messageId: z.string().optional(),
})

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string(),
    details: z.array(ErrorDetailSchema).optional(),
  }),
})

export function dataEnvelope<T extends z.ZodType>(schema: T) {
  return z.object({ data: schema })
}

export function listEnvelope<T extends z.ZodType>(schema: T) {
  return z.object({
    data: z.array(schema),
    pagination: PaginationSchema,
  })
}

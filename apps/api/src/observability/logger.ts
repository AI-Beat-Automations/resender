type LogLevel = "info" | "warn" | "error"

export type LogFields = {
  worker: "api"
  entrypoint: "fetch" | "rpc" | "queue" | "scheduled"
  event: string
  requestId?: string
  tenantId?: string
  route?: string
  status?: number
  durationMs?: number
  errorCode?: string
  jobId?: string
  messageId?: string
  eventId?: string
  attempt?: number
  queue?: string
  count?: number
}

export function log(level: LogLevel, fields: Omit<LogFields, "worker">) {
  const record: LogFields = { worker: "api", ...fields }
  if (level === "error") {
    console.error(record)
    return
  }
  if (level === "warn") {
    console.warn(record)
    return
  }
  console.log(record)
}

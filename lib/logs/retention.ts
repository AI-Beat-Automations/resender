// Aparte de `request-log.ts` para que la pantalla (cliente) pueda leer el número
// sin arrastrar al bundle el módulo que escribe en la base.

/** Días que vive una fila de `request_logs` antes de que el cron la borre. */
export const REQUEST_LOG_RETENTION_DAYS = 30

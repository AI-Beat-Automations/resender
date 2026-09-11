import { readFile } from "node:fs/promises"
import process from "node:process"

// Lector mínimo de archivos .env para los scripts de mantenimiento (Next carga
// el suyo solo dentro de la app). Lo que ya está en el entorno gana: pasar una
// variable en la línea de comandos siempre pisa al archivo.
//
// Devuelve `false` si el archivo no existe, para que quien llame decida si eso
// es un error o simplemente no había nada que cargar.
export async function loadEnvFile(filePath) {
  let contents

  try {
    contents = await readFile(filePath, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("#")) continue

    const separator = trimmed.indexOf("=")
    if (separator === -1) continue

    const key = trimmed
      .slice(0, separator)
      .replace(/^export\s+/, "")
      .trim()

    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      process.env[key] !== undefined
    ) {
      continue
    }

    let value = trimmed.slice(separator + 1).trim()
    const quote = value[0]

    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1)

      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r")
      }
    }

    process.env[key] = value
  }

  return true
}

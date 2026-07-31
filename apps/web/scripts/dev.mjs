import { spawn } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { connect } from "node:net"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"

const API_WORKER_NAME = "api"
const STARTUP_TIMEOUT_MS = 20_000
const RETRY_DELAY_MS = 250
const SOCKET_TIMEOUT_MS = 250

await waitForWorker(API_WORKER_NAME)

const nextCli = createRequire(import.meta.url).resolve("next/dist/bin/next")
const next = spawn(
  process.execPath,
  [nextCli, "dev", ...process.argv.slice(2)],
  { stdio: "inherit" }
)

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!next.killed) next.kill(signal)
  })
}

next.once("error", (error) => {
  throw error
})
next.once("exit", (code, signal) => {
  process.exitCode =
    code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)
})

async function waitForWorker(workerName) {
  const registryEntry = path.join(await wranglerRegistryPath(), workerName)
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  let lastError

  while (Date.now() < deadline) {
    try {
      const registration = JSON.parse(await readFile(registryEntry, "utf8"))
      if (
        typeof registration.userWorkerService !== "string" ||
        !registration.userWorkerService.endsWith(`:${workerName}`)
      ) {
        throw new Error("the registry entry does not identify the API Worker")
      }
      const address = parseAddress(registration.debugPortAddress)
      if (await socketIsLive(address)) {
        console.log(`[web] Wrangler Worker "${workerName}" is ready`)
        return
      }
      lastError = new Error("the registered Wrangler socket is not accepting")
    } catch (error) {
      lastError = error
    }
    await delay(RETRY_DELAY_MS)
  }

  throw new Error(
    `Timed out after ${STARTUP_TIMEOUT_MS}ms waiting for the local Wrangler Worker "${workerName}"`,
    { cause: lastError }
  )
}

function parseAddress(value) {
  if (typeof value !== "string") {
    throw new Error("the Wrangler registry entry has no debug address")
  }
  const separator = value.lastIndexOf(":")
  const hostname = value.slice(0, separator)
  const port = Number(value.slice(separator + 1))
  if (!hostname || !Number.isInteger(port) || port <= 0) {
    throw new Error("the Wrangler registry debug address is invalid")
  }
  return { hostname, port }
}

function socketIsLive({ hostname, port }) {
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port })
    const finish = (live) => {
      socket.destroy()
      resolve(live)
    }
    socket.setTimeout(SOCKET_TIMEOUT_MS)
    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
    socket.once("timeout", () => finish(false))
  })
}

async function wranglerRegistryPath() {
  if (process.env.WRANGLER_REGISTRY_PATH) {
    return path.resolve(process.env.WRANGLER_REGISTRY_PATH)
  }

  const legacyPath = path.join(os.homedir(), ".wrangler")
  try {
    await access(legacyPath)
    return path.join(legacyPath, "registry")
  } catch {
    // Wrangler falls through to its platform-specific config directory.
  }

  const configHome =
    process.env.XDG_CONFIG_HOME ??
    (process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Preferences")
      : process.platform === "win32"
        ? path.join(process.env.APPDATA ?? os.homedir(), "xdg.config")
        : path.join(os.homedir(), ".config"))
  return path.join(configHome, ".wrangler", "registry")
}

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const npmCli = process.env.npm_execpath
let activeChild

if (!npmCli) {
  throw new Error("npm_execpath is required. Start this server with `npm run dev`.")
}

const build = spawn(
  process.execPath,
  [npmCli, "--workspace", "web", "exec", "--", "opennextjs-cloudflare", "build"],
  { cwd: repoRoot, stdio: "inherit" }
)
activeChild = build

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (activeChild && !activeChild.killed) activeChild.kill(signal)
  })
}

const buildExitCode = await waitForExit(build)
if (buildExitCode !== 0) process.exit(buildExitCode)

const wranglerCli = path.join(
  repoRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js"
)
const server = spawn(
  process.execPath,
  [
    wranglerCli,
    "dev",
    "-c",
    "apps/web/wrangler.jsonc",
    "-c",
    "apps/api/wrangler.jsonc",
    "--local",
    ...process.argv.slice(2),
  ],
  { cwd: repoRoot, stdio: "inherit" }
)
activeChild = server

process.exitCode = await waitForExit(server)

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(128 + (signal === "SIGINT" ? 2 : 15))
        return
      }
      resolve(code ?? 1)
    })
  })
}

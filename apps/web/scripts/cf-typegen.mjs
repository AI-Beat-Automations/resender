import { spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"
import process from "node:process"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { experimental_readRawConfig } from "wrangler"

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(webRoot, "../..")
const generatedConfigName = ".wrangler-typegen.json"
const generatedConfigPath = path.join(webRoot, generatedConfigName)
const forwardedArgs = process.argv.slice(2)

if (
  forwardedArgs.length > 1 ||
  (forwardedArgs.length === 1 && forwardedArgs[0] !== "--check")
) {
  throw new Error("cf-typegen accepts only the optional --check flag.")
}

const { rawConfig } = experimental_readRawConfig({
  config: path.join(webRoot, "wrangler.jsonc"),
})

// OpenNext's main module is an ignored build artifact. Wrangler conditionally
// emits GlobalProps.mainModule when that file exists, so omit only `main` from
// the derived typegen config while preserving every tracked binding and env.
delete rawConfig.main
await writeFile(generatedConfigPath, `${JSON.stringify(rawConfig, null, 2)}\n`)

const wranglerCli = path.join(
  repoRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js"
)
const child = spawn(
  process.execPath,
  [
    wranglerCli,
    "types",
    "cloudflare-env.d.ts",
    "--config",
    generatedConfigName,
    "--config",
    "../api/wrangler.jsonc",
    "--env-file",
    ".dev.vars.example",
    "--env-interface",
    "CloudflareEnv",
    ...forwardedArgs,
  ],
  {
    cwd: webRoot,
    env: {
      ...process.env,
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    },
    stdio: "inherit",
  }
)

process.exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject)
  child.once("exit", (code, signal) => {
    if (signal) {
      resolve(128 + (signal === "SIGINT" ? 2 : 15))
      return
    }
    resolve(code ?? 1)
  })
})

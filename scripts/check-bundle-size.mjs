#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import {
  appendFileSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { gzipSync } from "node:zlib"

// Tamaño del bundle del Worker, medido y con techo.
//
// Es el **único muro duro que Next tiene en Cloudflare**. El resto de los
// límites de la plataforma no se tocan con este producto: a 200 webhooks/día por
// cliente, 10.000 tenants son ~185 req/s, que Workers no registra, y el cuello
// real es Neon. Pero el bundle sí crece, y crece con dependencias y features en
// vez de con tráfico: entre el 30 de julio y el 21 de agosto pasó de 3,96 MB a
// 5,96 MB gzip —un 50 %— por adjuntos, comentarios de Instagram y labels.
//
// Sin esta medición, ese número solo se descubre el día que un deploy es
// rechazado, que es el peor momento posible. Con ella, aparece en el PR que lo
// empuja.
//
// Cuando el aviso salte de verdad, la respuesta correcta **no** es separar la
// API de Next: es sacar marketing y blog (shiki, MDX, el contenido) a su propio
// Worker. Ese es el corte natural de esta app, y está escrito en el ADR 0012.

const MB = 1024 * 1024

// El techo real de Cloudflare en el plan Paid, comprimido.
const CLOUDFLARE_LIMIT = 10 * MB

// Falla el build. Deja ~2 MB de aire sobre el techo real, que es más o menos lo
// que creció el bundle en tres semanas: si se cruza, todavía hay una entrega
// entera de margen para reaccionar en vez de un deploy roto.
const FAIL_AT = 8 * MB

// No falla, avisa. Es el punto donde conviene empezar a planear el corte de
// marketing, no el punto donde hay que hacerlo.
const WARN_AT = 6.5 * MB

const OUT_DIR = ".wrangler/bundle-size-check"
const WORKER = ".open-next/worker.js"

function fail(message) {
  console.error(`::error::${message}`)
  process.exit(1)
}

try {
  statSync(WORKER)
} catch {
  fail(
    `No existe ${WORKER}. Corré \`npx opennextjs-cloudflare build\` antes de medir.`
  )
}

// El dry-run es lo que mide de verdad: `.open-next/worker.js` es solo el
// entrypoint, y lo que Cloudflare recibe es el bundle de esbuild con todo
// adentro. Medir el entrypoint daría 2 KB y no querría decir nada.
try {
  // `--env=""` selecciona explícitamente el entorno de nivel superior. Sin él
  // wrangler avisa que hay varios entornos definidos y no sabe cuál medir; el
  // de producción es el que importa, porque es el que se despliega.
  execFileSync(
    "npx",
    ["wrangler", "deploy", "--dry-run", "--env=", "--outdir", OUT_DIR],
    { stdio: ["ignore", "ignore", "ignore"] }
  )
} catch {
  fail("`wrangler deploy --dry-run` falló; no se pudo medir el bundle.")
}

// **Todos** los módulos del bundle, no solo `worker.js`. Lo que Cloudflare pesa
// es el Worker con lo que arrastra, y acá adentro hay `.wasm` que no son
// menores: `resvg.wasm` solo son 1,4 MB. Medir el entrypoint daría un número
// tranquilizador y falso.
//
// Los `.map` quedan afuera porque no se suben.
let raw = 0
let gzipped = 0
for (const name of readdirSync(OUT_DIR)) {
  if (name.endsWith(".map")) continue
  const contents = readFileSync(join(OUT_DIR, name))
  raw += contents.length
  // Cloudflare aplica el límite sobre el contenido comprimido, así que el
  // número que importa es este y no el tamaño en disco.
  gzipped += gzipSync(contents).length
}
rmSync(OUT_DIR, { recursive: true, force: true })

const mb = (bytes) => `${(bytes / MB).toFixed(2)} MB`
const pct = Math.round((gzipped / CLOUDFLARE_LIMIT) * 100)
const summary = `Bundle del Worker: **${mb(gzipped)}** gzip · ${pct}% del techo de ${mb(CLOUDFLARE_LIMIT)} de Cloudflare`

console.log(`${summary} (crudo: ${mb(raw)})`)

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
}

if (gzipped >= FAIL_AT) {
  fail(
    `${mb(gzipped)} gzip supera el umbral de ${mb(FAIL_AT)}. ` +
      `El techo de Cloudflare es ${mb(CLOUDFLARE_LIMIT)} y un deploy por encima se rechaza. ` +
      `El corte previsto es sacar marketing y blog a su propio Worker (ADR 0012), no separar la API.`
  )
}

if (gzipped >= WARN_AT) {
  console.log(
    `::warning::Bundle en ${mb(gzipped)} gzip (${pct}% del techo). ` +
      `Falla a partir de ${mb(FAIL_AT)}. Momento de planear el corte de marketing y blog (ADR 0012).`
  )
}

import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

// Dos proyectos, y no uno, porque el runtime no puede ser el mismo.
//
// - `workers`: todo lo de `src/**`, dentro de workerd, que es donde corre el
//   Worker de verdad. Es la suite histórica y no cambia.
// - `postgres`: los tests de `test/postgres/**`, en Node, porque ejecutan SQL
//   real contra PGlite (Postgres compilado a WASM, que necesita `node:fs` y no
//   arranca dentro de workerd). Son los que cazan lo que un doble de `sql`
//   nunca puede cazar: un bind sin tipo inferible, un check que rechaza el
//   valor, un `on conflict` que no dispara.
//
// Los dos corren con `npm run test:run` (`vitest run` recorre los proyectos).
export default defineConfig({
  logLevel: "error",
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                DATABASE_URL: "postgresql://user:password@localhost/resender",
                AUTH_SECRET: "development-only",
                API_KEY_PEPPER: "development-only",
                TOKEN_ENCRYPTION_KEY:
                  "0000000000000000000000000000000000000000000000000000000000000000",
                META_APP_ID: "development-only",
                META_APP_SECRET: "development-only",
                META_VERIFY_TOKEN: "development-only",
                // Distintos de los de Facebook a propósito: los tests de
                // runtime comprueban que un webhook de Instagram firmado con el
                // secreto de Facebook se rechaza, y que el challenge de
                // WhatsApp no acepta el verify token de Messenger; con valores
                // iguales esas pruebas pasarían solas.
                INSTAGRAM_APP_ID: "development-only-instagram",
                INSTAGRAM_APP_SECRET: "development-only-instagram-secret",
                INSTAGRAM_VERIFY_TOKEN: "development-only-instagram-verify",
                // WhatsApp comparte META_APP_SECRET para la firma HMAC: lo
                // único propio es el verify token del challenge.
                WHATSAPP_VERIFY_TOKEN: "development-only-whatsapp-verify",
                STRIPE_SECRET_KEY: "rk_test_development-only",
                STRIPE_WEBHOOK_SECRET: "whsec_development-only",
              },
            },
          }),
        ],
        test: {
          name: "workers",
          include: ["src/**/*.{test,spec}.ts"],
        },
      },
      {
        test: {
          name: "postgres",
          environment: "node",
          include: ["test/postgres/**/*.test.ts"],
          // Arrancar PGlite y correr las 17 migraciones cuesta unos segundos
          // la primera vez; el default de 5 s se queda corto en frío.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})

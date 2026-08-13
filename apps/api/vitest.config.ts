import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig({
  logLevel: "error",
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
          // Distintos de los de Facebook a propósito: los tests de runtime
          // comprueban que un webhook de Instagram firmado con el secreto de
          // Facebook se rechaza, y que el challenge de WhatsApp no acepta el
          // verify token de Messenger; con valores iguales esas pruebas
          // pasarían solas.
          INSTAGRAM_APP_ID: "development-only-instagram",
          INSTAGRAM_APP_SECRET: "development-only-instagram-secret",
          INSTAGRAM_VERIFY_TOKEN: "development-only-instagram-verify",
          // WhatsApp comparte META_APP_SECRET para la firma HMAC: lo único
          // propio es el verify token del challenge.
          WHATSAPP_VERIFY_TOKEN: "development-only-whatsapp-verify",
          STRIPE_SECRET_KEY: "rk_test_development-only",
          STRIPE_WEBHOOK_SECRET: "whsec_development-only",
        },
      },
    }),
  ],
  test: {
    include: ["src/**/*.{test,spec}.ts"],
  },
})

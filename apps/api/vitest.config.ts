import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

const TEST_WRANGLER_CONFIG = "./test/wrangler.jsonc"

export default defineConfig({
  logLevel: "error",
  plugins: [
    cloudflareTest({
      // This config lives away from the product `.dev.vars`; never point the
      // test pool at the production Wrangler config in the package root.
      wrangler: { configPath: TEST_WRANGLER_CONFIG },
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

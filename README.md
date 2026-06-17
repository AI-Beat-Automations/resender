# Echo

Echo is a Messenger gateway and durable log for external automations.

## MVP environment

`apps/web` expects these variables for the MVP stack:

```bash
APP_URL="https://your-public-origin.example"
AUTH_SECRET="generate-a-long-random-secret"
DATABASE_URL="postgres://user:password@host:5432/db"
TOKEN_ENCRYPTION_KEY="generate-with-openssl-rand-hex-32"
META_APP_SECRET="meta-app-secret"
META_VERIFY_TOKEN="meta-webhook-verify-token"
NEXT_PUBLIC_META_APP_ID="meta-app-id"
NEXT_PUBLIC_META_CONFIG_ID="meta-login-config-id"
```

Run database migrations manually after setting `DATABASE_URL`:

```bash
npm --workspace web run db:migrate
```

Generate `TOKEN_ENCRYPTION_KEY` with:

```bash
openssl rand -hex 32
```

## Validation

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

## Adding components

To add components to your app, run the following command at the root of the repo:

```bash
npm exec shadcn@latest add button -c apps/web
```

This will place the ui components in the `packages/ui/src/components` directory.

## Using components

To use the components in your app, import them from the `ui` package.

```tsx
import { Button } from "@workspace/ui/components/button";
```

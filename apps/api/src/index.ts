import { ApiService } from "./application/service"
import {
  consumeWebhookQueue,
  recoverWebhookJobs,
} from "./application/webhook-delivery"
import { WebAppApi } from "./entrypoints/web-app-api"
import { createApp } from "./http/app"
import { log } from "./observability/logger"

const app = createApp()

export { WebAppApi }

export default {
  fetch(request, env, context) {
    return app.fetch(request, env, context)
  },

  async queue(batch, env) {
    const service = new ApiService(env)
    await consumeWebhookQueue(batch, env, service.repository)
  },

  async scheduled(controller, env) {
    const service = new ApiService(env)
    const recovered = await recoverWebhookJobs(env, service.repository)
    log("info", {
      entrypoint: "scheduled",
      event: "webhook_jobs_recovered",
      count: recovered,
    })
    void controller
  },
} satisfies ExportedHandler<Env>

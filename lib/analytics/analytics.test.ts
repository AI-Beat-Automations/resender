import { beforeEach, describe, expect, it, vi } from "vitest"

const { captureDeferred } = vi.hoisted(() => ({ captureDeferred: vi.fn() }))
vi.mock("@/lib/posthog", () => ({ posthog: null, captureDeferred }))

import { connectionEventProperties } from "./connections"
import { analyticsPlanOf, analyticsPlanOfLimits, planMrr } from "./plans"
import {
  captureUsageThreshold,
  crossedThreshold,
  messageEventProperties,
  quotaContextOf,
} from "./usage"
import { signupMethodOf } from "./user-registered"
import { FREE_PLAN, getPlanByLookupKey, PLANS } from "@/lib/billing/plans"

beforeEach(() => captureDeferred.mockClear())

describe("analyticsPlanOf", () => {
  it("acorta la lookup key de Stripe", () => {
    expect(analyticsPlanOf("starter_monthly")).toBe("starter")
    expect(analyticsPlanOf("pro_monthly")).toBe("pro")
    expect(analyticsPlanOf("business_monthly")).toBe("business")
  })

  it("cae en free sin lookup key o con una desconocida", () => {
    expect(analyticsPlanOf(null)).toBe("free")
    expect(analyticsPlanOf("price_123")).toBe("free")
  })
})

describe("planMrr", () => {
  it("es el precio de lista del catálogo", () => {
    expect(planMrr("free")).toBe(0)
    expect(planMrr("starter")).toBe(15)
    expect(planMrr("pro")).toBe(29)
    expect(planMrr("business")).toBe(199)
  })
})

describe("analyticsPlanOfLimits", () => {
  it("reconoce cada plan por sus límites", () => {
    for (const plan of PLANS) {
      expect(analyticsPlanOfLimits(false, plan.limits)).toBe(
        analyticsPlanOf(plan.lookupKey)
      )
    }
  })

  it("es free con el Free derivado o sin límites resueltos", () => {
    expect(analyticsPlanOfLimits(true, FREE_PLAN.limits)).toBe("free")
    expect(analyticsPlanOfLimits(false, null)).toBe("free")
  })
})

describe("crossedThreshold", () => {
  it("devuelve el umbral solo en el conteo exacto que lo cruza", () => {
    expect(crossedThreshold(1600, 2000)).toBe(80)
    expect(crossedThreshold(2000, 2000)).toBe(100)
    expect(crossedThreshold(1599, 2000)).toBeNull()
    expect(crossedThreshold(1601, 2000)).toBeNull()
    expect(crossedThreshold(2001, 2000)).toBeNull()
  })

  it("redondea hacia arriba el 80 % de un límite impar", () => {
    expect(crossedThreshold(9, 11)).toBe(80)
  })

  it("no dispara sin límite", () => {
    expect(crossedThreshold(1, null)).toBeNull()
    expect(crossedThreshold(0, 0)).toBeNull()
  })
})

describe("captureUsageThreshold", () => {
  const quota = quotaContextOf({ isFree: true, limits: FREE_PLAN.limits })

  it("manda `message limit reached` al cruzar un umbral", () => {
    captureUsageThreshold("tenant-1", 1600, quota)
    expect(captureDeferred).toHaveBeenCalledWith({
      distinctId: "tenant-1",
      event: "message limit reached",
      properties: {
        threshold: 80,
        plan: "free",
        messages_used: 1600,
        messages_limit: 2000,
      },
    })
  })

  it("no manda nada entre umbrales", () => {
    captureUsageThreshold("tenant-1", 1700, quota)
    expect(captureDeferred).not.toHaveBeenCalled()
  })
})

describe("messageEventProperties", () => {
  it("nombra la conexión, el cliente y el plan", () => {
    const quota = quotaContextOf({
      isFree: false,
      limits: getPlanByLookupKey("pro_monthly")?.limits ?? null,
    })
    expect(
      messageEventProperties({ id: "conn-1", clientAccountId: null }, quota)
    ).toEqual({ connection_id: "conn-1", client_id: null, plan: "pro" })
  })
})

describe("signupMethodOf", () => {
  it("distingue el callback de Google del alta por correo", () => {
    expect(
      signupMethodOf({ path: "/callback/:id", params: { id: "google" } })
    ).toBe("google")
    expect(signupMethodOf({ path: "/sign-up/email" })).toBe("email")
    expect(signupMethodOf(null)).toBe("email")
  })
})

describe("connectionEventProperties", () => {
  it("omite lo que no se pudo resolver en vez de mandarlo vacío", () => {
    expect(
      connectionEventProperties({
        channel: "instagram",
        connectionId: "conn-1",
        clientId: null,
        connectionsCount: null,
      })
    ).toEqual({ channel: "instagram", connection_id: "conn-1", client_id: null })
  })

  it("actualiza `connections_count` en la persona", () => {
    expect(
      connectionEventProperties({
        channel: "whatsapp",
        connectionId: "conn-1",
        clientId: "client-1",
        isFirstConnection: true,
        connectionsCount: 2,
      })
    ).toEqual({
      channel: "whatsapp",
      connection_id: "conn-1",
      client_id: "client-1",
      is_first_connection: true,
      $set: { connections_count: 2 },
    })
  })
})

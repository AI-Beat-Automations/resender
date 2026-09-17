import { describe, expect, it } from "vitest"

import { es } from "@/content/i18n/app/es"

import {
  evaluateClientLimits,
  formatClientConnectRejection,
  formatClientLimitNotice,
  isClientLimitReason,
  type ClientLimitsInput,
} from "./client-limits"

// Regla de cupo al conectar como cliente (issue #154, ticket 3). Tests de
// tabla, sin mocks, como `lib/billing/entitlements.test.ts`.
function input(overrides: Partial<ClientLimitsInput> = {}): ClientLimitsInput {
  return {
    planMaxPages: 5,
    tenantActiveCount: 1,
    clientMaxConnections: 2,
    clientActiveCount: 0,
    ...overrides,
  }
}

describe("evaluateClientLimits", () => {
  it("deja conectar cuando quedan huecos en el tope y en el plan", () => {
    const result = evaluateClientLimits(input())
    expect(result.verdict).toBe("allowed")
    expect(result.remainingSlots).toBe(2)
    expect(result.nearLimit).toBe(false)
  })

  it("corta por el tope del cliente cuando lo alcanza", () => {
    const result = evaluateClientLimits(input({ clientActiveCount: 2 }))
    expect(result.verdict).toBe("client_limit_reached")
    expect(result.remainingSlots).toBe(0)
  })

  // El plan del padre es el techo de todos: aunque al cliente le queden
  // huecos de su tope, sin cupo global no hay fila nueva.
  it("corta por el límite global del padre aunque el cliente no llegó al suyo", () => {
    const result = evaluateClientLimits(
      input({ planMaxPages: 5, tenantActiveCount: 5, clientActiveCount: 1 })
    )
    expect(result.verdict).toBe("tenant_limit_reached")
    expect(result.remainingSlots).toBe(0)
  })

  it("nombra el tope propio cuando los dos límites están llenos a la vez", () => {
    const result = evaluateClientLimits(
      input({ tenantActiveCount: 5, clientActiveCount: 2 })
    )
    expect(result.verdict).toBe("client_limit_reached")
  })

  // Los huecos reales son los que caben en los dos límites: con tope 3 y un
  // plan al que le queda 1, la pantalla de selección tiene que ofrecer 1.
  it("los huecos restantes son el menor entre el tope y lo que le queda al plan", () => {
    const result = evaluateClientLimits(
      input({
        planMaxPages: 5,
        tenantActiveCount: 4,
        clientMaxConnections: 3,
        clientActiveCount: 0,
      })
    )
    expect(result.verdict).toBe("allowed")
    expect(result.remainingSlots).toBe(1)
  })

  describe("aviso de proximidad", () => {
    it("avisa cuando queda un solo hueco del tope", () => {
      const result = evaluateClientLimits(
        input({ clientMaxConnections: 2, clientActiveCount: 1 })
      )
      expect(result.verdict).toBe("allowed")
      expect(result.nearLimit).toBe(true)
    })

    it("avisa desde el 80 % del tope", () => {
      const result = evaluateClientLimits(
        input({
          planMaxPages: 40,
          clientMaxConnections: 10,
          clientActiveCount: 8,
        })
      )
      expect(result.nearLimit).toBe(true)
    })

    it("no avisa a quien todavía no conectó nada", () => {
      const result = evaluateClientLimits(
        input({ clientMaxConnections: 1, clientActiveCount: 0 })
      )
      expect(result.verdict).toBe("allowed")
      expect(result.nearLimit).toBe(false)
    })

    it("no avisa de proximidad cuando ya está en el tope", () => {
      const result = evaluateClientLimits(
        input({ clientMaxConnections: 2, clientActiveCount: 2 })
      )
      expect(result.nearLimit).toBe(false)
    })
  })

  // El padre puede bajar el tope por debajo de lo ya conectado: es un máximo,
  // no una reserva. El cliente queda en el tope, sin huecos y sin negativos.
  it("un tope menor que lo conectado deja al cliente en el tope, sin negativos", () => {
    const result = evaluateClientLimits(
      input({ clientMaxConnections: 1, clientActiveCount: 3 })
    )
    expect(result.verdict).toBe("client_limit_reached")
    expect(result.remainingSlots).toBe(0)
  })

  // Sin cliente (el padre) la regla es la de siempre: el cupo del plan, sin
  // aviso de proximidad —el suyo es el de cuota, que ya existe—.
  describe("padre sin cliente", () => {
    it("aplica solo el límite del plan", () => {
      const result = evaluateClientLimits(
        input({ clientMaxConnections: null, tenantActiveCount: 3 })
      )
      expect(result.verdict).toBe("allowed")
      expect(result.remainingSlots).toBe(2)
      expect(result.nearLimit).toBe(false)
    })

    it("corta por el plan cuando está lleno", () => {
      const result = evaluateClientLimits(
        input({ clientMaxConnections: null, tenantActiveCount: 5 })
      )
      expect(result.verdict).toBe("tenant_limit_reached")
      expect(result.remainingSlots).toBe(0)
    })

    it("nunca avisa de proximidad, ni con un hueco", () => {
      const result = evaluateClientLimits(
        input({ clientMaxConnections: null, tenantActiveCount: 4 })
      )
      expect(result.nearLimit).toBe(false)
    })
  })
})

// Los avisos nombran al padre y nunca hablan de planes ni precios: el
// cliente no puede hacer nada con esa información.
describe("formatClientLimitNotice", () => {
  const owner = "Agencia Norte"

  it("no hay aviso mientras sobra cupo", () => {
    expect(
      formatClientLimitNotice(evaluateClientLimits(input()), owner, es)
    ).toBeNull()
  })

  it("el aviso de proximidad nombra al padre", () => {
    const notice = formatClientLimitNotice(
      evaluateClientLimits(input({ clientActiveCount: 1 })),
      owner,
      es
    )
    expect(notice?.level).toBe("warning")
    expect(notice?.body).toContain(owner)
    expect(notice?.body).toContain("1 de 2")
  })

  it("el tope propio y el límite del padre son el mismo tipo de aviso", () => {
    const own = formatClientLimitNotice(
      evaluateClientLimits(input({ clientActiveCount: 2 })),
      owner,
      es
    )
    const tenant = formatClientLimitNotice(
      evaluateClientLimits(input({ tenantActiveCount: 5 })),
      owner,
      es
    )
    expect(own?.level).toBe("blocked")
    expect(tenant?.level).toBe("blocked")
    expect(own?.body).toContain(owner)
    expect(tenant?.body).toContain(owner)
    for (const text of [own?.title, own?.body, tenant?.title, tenant?.body]) {
      expect(text).not.toMatch(/plan|precio|\$/i)
    }
  })

  it("sin nombre del padre lo nombra por su rol", () => {
    const notice = formatClientLimitNotice(
      evaluateClientLimits(input({ clientActiveCount: 2 })),
      null,
      es
    )
    expect(notice?.body).toContain(es.clientLimits.ownerFallback)
  })

  it("el padre no recibe aviso de este módulo", () => {
    expect(
      formatClientLimitNotice(
        evaluateClientLimits(
          input({ clientMaxConnections: null, tenantActiveCount: 5 })
        ),
        owner,
        es
      )
    ).toBeNull()
  })
})

describe("formatClientConnectRejection", () => {
  it("redacta el rechazo por tope propio y por límite del padre nombrándolo", () => {
    expect(
      formatClientConnectRejection("client_limit_reached", "Agencia", es)
    ).toContain("Agencia")
    expect(
      formatClientConnectRejection("tenant_limit_reached", "Agencia", es)
    ).toContain("Agencia")
  })
})

describe("isClientLimitReason", () => {
  it("reconoce los dos motivos de rechazo y ningún otro", () => {
    expect(isClientLimitReason("client_limit_reached")).toBe(true)
    expect(isClientLimitReason("tenant_limit_reached")).toBe(true)
    expect(isClientLimitReason("instagram_page_limit_reached")).toBe(false)
    expect(isClientLimitReason(null)).toBe(false)
  })
})

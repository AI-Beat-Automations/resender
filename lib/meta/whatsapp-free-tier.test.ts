import { describe, expect, it } from "vitest"

import {
  META_FREE_SERVICE_MESSAGES_PER_MONTH,
  buildMetaFreeTierView,
  metaFreeTierPeriod,
  reachedAlertThresholds,
  resolveMetaFreeTierState,
} from "./whatsapp-free-tier"

describe("metaFreeTierPeriod", () => {
  it("corta el mes en UTC, del día 1 al día 1 del siguiente", () => {
    expect(metaFreeTierPeriod(new Date("2026-10-15T12:00:00Z"))).toEqual({
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-11-01T00:00:00Z"),
    })
  })

  it("el primer instante del mes es de ese mes", () => {
    expect(metaFreeTierPeriod(new Date("2026-11-01T00:00:00Z")).start).toEqual(
      new Date("2026-11-01T00:00:00Z")
    )
  })

  it("el último milisegundo del mes sigue en ese mes", () => {
    expect(
      metaFreeTierPeriod(new Date("2026-10-31T23:59:59.999Z")).start
    ).toEqual(new Date("2026-10-01T00:00:00Z"))
  })

  // Las 20:00 del 31 en Ciudad de México ya son el 1 en UTC: el corte es UTC,
  // no la hora local del servidor ni de la WABA.
  it("usa UTC y no la zona local", () => {
    expect(
      metaFreeTierPeriod(new Date("2026-10-31T20:00:00-06:00")).start
    ).toEqual(new Date("2026-11-01T00:00:00Z"))
  })

  it("diciembre cierra en el enero del año siguiente", () => {
    expect(metaFreeTierPeriod(new Date("2026-12-31T23:59:59Z"))).toEqual({
      start: new Date("2026-12-01T00:00:00Z"),
      end: new Date("2027-01-01T00:00:00Z"),
    })
    expect(metaFreeTierPeriod(new Date("2027-01-01T00:00:00Z")).start).toEqual(
      new Date("2027-01-01T00:00:00Z")
    )
  })

  it("febrero de año bisiesto", () => {
    expect(metaFreeTierPeriod(new Date("2028-02-29T10:00:00Z")).end).toEqual(
      new Date("2028-03-01T00:00:00Z")
    )
  })
})

describe("estado de la barra", () => {
  it("el cupo es de 1.000 mensajes", () => {
    expect(META_FREE_SERVICE_MESSAGES_PER_MONTH).toBe(1000)
  })

  it.each([
    [0, "within", []],
    [799, "within", []],
    [800, "near", [80]],
    [1000, "charged", [80, 100]],
    [1200, "charged", [80, 100]],
  ] as const)(
    "con %i mensajes de servicio está en %s",
    (count, state, thresholds) => {
      expect(resolveMetaFreeTierState(count)).toBe(state)
      expect(reachedAlertThresholds(count)).toEqual(thresholds)
    }
  )

  it("topa los gratis en el cupo y deja los cobrados aparte", () => {
    expect(
      buildMetaFreeTierView({ serviceCount: 1200, billedCount: 212 })
    ).toEqual({
      state: "charged",
      freeUsed: 1000,
      freeLimit: 1000,
      percent: 100,
      billedCount: 212,
    })
    expect(
      buildMetaFreeTierView({ serviceCount: 734, billedCount: 0 })
    ).toEqual({
      state: "within",
      freeUsed: 734,
      freeLimit: 1000,
      percent: 73,
      billedCount: 0,
    })
  })
})

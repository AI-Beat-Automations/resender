import { describe, expect, it } from "vitest"

import { extractWhatsappContactSync } from "./batch"
import { PHONE_NUMBER_ID, USER_PHONE, WABA_ID, webhook } from "./test-fixtures"

describe("WhatsApp contact sync", () => {
  const sync = (...items: unknown[]) =>
    extractWhatsappContactSync(
      webhook("smb_app_state_sync", { state_sync: items })
    )

  // El array se llama `state_sync[]`, no `contacts[]`, y una **edición** de
  // contacto llega como `add`: el consumidor hace upsert, no insert.
  it("reads an add with the full contact", () => {
    expect(
      sync({
        type: "contact",
        contact: {
          full_name: "Pablo Morales",
          first_name: "Pablo",
          phone_number: USER_PHONE,
        },
        action: "add",
        metadata: { timestamp: "1739321024" },
      })
    ).toEqual([
      {
        wabaId: WABA_ID,
        providerPhoneNumberId: PHONE_NUMBER_ID,
        action: "add",
        phoneNumber: USER_PHONE,
        fullName: "Pablo Morales",
        firstName: "Pablo",
        timestamp: new Date(1_739_321_024_000),
      },
    ])
  })

  // En un `remove` solo llega el teléfono: la clave de deduplicación no puede
  // ser el nombre.
  it("reads a remove that only carries the phone number", () => {
    expect(
      sync({
        type: "contact",
        contact: { phone_number: USER_PHONE },
        action: "remove",
        metadata: { timestamp: "1739321024" },
      })
    ).toEqual([
      {
        wabaId: WABA_ID,
        providerPhoneNumberId: PHONE_NUMBER_ID,
        action: "remove",
        phoneNumber: USER_PHONE,
        fullName: null,
        firstName: null,
        timestamp: new Date(1_739_321_024_000),
      },
    ])
  })

  it("drops entries without a phone number or with an action it does not know", () => {
    expect(
      sync(
        {
          type: "contact",
          contact: { full_name: "Sin teléfono" },
          action: "add",
        },
        {
          type: "contact",
          contact: { phone_number: USER_PHONE },
          action: "update",
        },
        null
      )
    ).toEqual([])
  })
})

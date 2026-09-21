import { describe, expect, it } from "vitest"

import { indexRawFragments } from "./raw-fragments"

describe("indexRawFragments", () => {
  it("reduce un POST de Messenger con dos páginas al evento pedido", () => {
    const body = {
      object: "page",
      entry: [
        {
          id: "page_a",
          time: 1,
          messaging: [
            { sender: { id: "u1" }, message: { mid: "mid.a1", text: "uno" } },
            { sender: { id: "u2" }, message: { mid: "mid.a2", text: "dos" } },
          ],
        },
        {
          id: "page_b",
          time: 2,
          messaging: [
            { sender: { id: "u3" }, message: { mid: "mid.b1", text: "otro" } },
          ],
        },
      ],
    }
    const index = indexRawFragments(body, "messenger")

    expect(index.message("mid.a2")).toEqual({
      id: "page_a",
      time: 1,
      messaging: [
        { sender: { id: "u2" }, message: { mid: "mid.a2", text: "dos" } },
      ],
    })
    // Nada del otro tenant se cuela en el fragmento.
    expect(JSON.stringify(index.message("mid.a2"))).not.toContain("page_b")
    expect(index.message("mid.nope")).toBeNull()
    expect(index.message(null)).toBeNull()
  })

  it("indexa postbacks por su mid", () => {
    const index = indexRawFragments(
      {
        entry: [
          { id: "p", messaging: [{ postback: { mid: "mid.pb", payload: "X" } }] },
        ],
      },
      "messenger"
    )
    expect(index.message("mid.pb")).toMatchObject({
      messaging: [{ postback: { payload: "X" } }],
    })
  })

  it("indexa comentarios de Instagram, en changes[] o aplanados", () => {
    const index = indexRawFragments(
      {
        entry: [
          {
            id: "ig_1",
            time: 5,
            changes: [{ field: "comments", value: { id: "c1", text: "hola" } }],
          },
          { id: "ig_1", field: "comments", value: { comment_id: "c2" } },
        ],
      },
      "instagram"
    )
    expect(index.comment("c1")).toEqual({
      id: "ig_1",
      time: 5,
      changes: [{ field: "comments", value: { id: "c1", text: "hola" } }],
    })
    expect(index.comment("c2")).toMatchObject({
      changes: [{ value: { comment_id: "c2" } }],
    })
  })

  it("en WhatsApp conserva metadata y deja un solo mensaje o acuse", () => {
    const metadata = { phone_number_id: "pn_1", display_phone_number: "555" }
    const index = indexRawFragments(
      {
        entry: [
          {
            id: "waba_1",
            changes: [
              {
                field: "messages",
                value: {
                  metadata,
                  contacts: [{ wa_id: "549" }],
                  messages: [{ id: "wamid.1" }, { id: "wamid.2" }],
                  statuses: [
                    { id: "wamid.9", status: "sent" },
                    { id: "wamid.9", status: "delivered" },
                  ],
                },
              },
              {
                field: "smb_message_echoes",
                value: { metadata, message_echoes: [{ id: "wamid.e" }] },
              },
            ],
          },
        ],
      },
      "whatsapp"
    )

    expect(index.message("wamid.2")).toEqual({
      id: "waba_1",
      time: undefined,
      changes: [
        {
          field: "messages",
          value: {
            metadata,
            contacts: [{ wa_id: "549" }],
            messages: [{ id: "wamid.2" }],
          },
        },
      ],
    })
    expect(index.status("wamid.9", "delivered")).toMatchObject({
      changes: [
        { value: { statuses: [{ id: "wamid.9", status: "delivered" }] } },
      ],
    })
    expect(index.message("wamid.e")).toMatchObject({
      changes: [{ field: "smb_message_echoes" }],
    })
  })

  it("un body con forma inesperada no lanza", () => {
    for (const body of [null, "x", 3, { entry: "no" }, { entry: [null, 1] }]) {
      const index = indexRawFragments(body, "whatsapp")
      expect(index.message("a")).toBeNull()
    }
  })
})

import { describe, expect, it } from "vitest"

import { en } from "@/content/i18n/app/en"
import { es } from "@/content/i18n/app/es"

import { toTemplateDisplay } from "./template-display"

// El envío de plantilla más común, tal como queda en `template_meta`: la forma
// está copiada de los fixtures del builder (`lib/meta/whatsapp-client.test.ts`)
// y del insert de la 0018 en `db/migrations/migrations.test.ts`, no inventada.
const ORDER_UPDATE = {
  name: "order_update",
  language: "es",
  components: [
    { type: "body", parameters: [{ type: "text", text: "A-1024" }] },
  ],
}

describe("toTemplateDisplay", () => {
  it("muestra la identidad de la plantilla y los valores enviados", () => {
    // Lo que se ve **no** es el cuerpo de la plantilla con las variables
    // sustituidas: ese texto es de Meta y no se guarda en ninguna parte de
    // Resender (ADR 0014). Lo que consta es el par nombre+idioma —que es el
    // identificador de la plantilla— y los valores que viajaron.
    expect(toTemplateDisplay(ORDER_UPDATE, es)).toEqual({
      label: "plantilla · order_update · es",
      values: ["A-1024"],
    })
  })

  it("traduce la etiqueta y deja los valores intactos", () => {
    // Los valores son datos del cliente final: se pintan tal como se enviaron,
    // en los dos idiomas. Lo único traducible es la etiqueta.
    expect(toTemplateDisplay(ORDER_UPDATE, en)).toEqual({
      label: "template · order_update · es",
      values: ["A-1024"],
    })
  })

  it("distingue dos idiomas de la misma plantilla", () => {
    // La identidad de una plantilla es `(nombre, idioma)`: dos filas con el
    // mismo nombre y distinto idioma son dos plantillas distintas, y la
    // etiqueta tiene que dejarlo ver.
    const label = (language: string) =>
      toTemplateDisplay({ ...ORDER_UPDATE, language }, es)?.label

    expect(label("es_AR")).toBe("plantilla · order_update · es_AR")
    expect(label("en_US")).toBe("plantilla · order_update · en_US")
  })

  it("no es un envío de plantilla cuando no hay jsonb", () => {
    // Es el caso de todo Messenger, todo Instagram y el WhatsApp libre: la
    // columna es null y la burbuja se pinta como siempre. `null` significa
    // «esto no es una plantilla», no «no supe leerla».
    expect(toTemplateDisplay(null, es)).toBeNull()
    expect(toTemplateDisplay(undefined, es)).toBeNull()
  })

  it("mantiene el orden en que los valores viajaron a Meta", () => {
    // Sin el cuerpo aprobado, el orden es lo único que relaciona un valor con
    // su marcador (`{{1}}`, `{{2}}`, …). Reordenar o agrupar por componente
    // rompería la única pista que le queda a quien lee el hilo.
    const display = toTemplateDisplay(
      {
        name: "shipping_update",
        language: "es",
        components: [
          { type: "header", parameters: [{ type: "text", text: "Envío" }] },
          {
            type: "body",
            parameters: [
              { type: "text", text: "Lorena" },
              { type: "text", text: "A-1024" },
              { type: "text", text: "mañana" },
            ],
          },
        ],
      },
      es
    )

    expect(display?.values).toEqual(["Envío", "Lorena", "A-1024", "mañana"])
  })

  it("lee los parámetros nombrados igual que los posicionales", () => {
    // Meta admite `parameter_name` junto al `text`. El nombre de la variable no
    // se muestra —sin el cuerpo, `customer_name` no le agrega nada a quien lee
    // el valor— pero el valor no se puede perder por venir en esa forma.
    const display = toTemplateDisplay(
      {
        name: "order_update",
        language: "es",
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "customer_name", text: "Lorena" },
            ],
          },
        ],
      },
      es
    )

    expect(display?.values).toEqual(["Lorena"])
  })

  it("usa el fallback_value de currency y date_time", () => {
    // No viajan como texto: llevan un objeto homónimo con el `fallback_value`,
    // que es la cadena que Meta misma le muestra al contacto cuando no puede
    // localizar el valor. Es exactamente lo que la burbuja quiere mostrar.
    const display = toTemplateDisplay(
      {
        name: "payment_reminder",
        language: "es",
        components: [
          {
            type: "body",
            parameters: [
              {
                type: "currency",
                currency: {
                  fallback_value: "$100.99",
                  code: "USD",
                  amount_1000: 100990,
                },
              },
              {
                type: "date_time",
                date_time: { fallback_value: "20 de febrero" },
              },
            ],
          },
        ],
      },
      es
    )

    expect(display?.values).toEqual(["$100.99", "20 de febrero"])
  })

  it("no pinta enlaces de media ni payloads de botón", () => {
    // Ninguno de los dos es algo que el contacto haya visto: el `link` de un
    // header es una URL firmada y el `payload` de un botón es un dato del
    // integrador. Se descartan sin ruido, y el resto del envío se pinta igual.
    const display = toTemplateDisplay(
      {
        name: "order_update",
        language: "es",
        components: [
          {
            type: "header",
            parameters: [
              { type: "image", image: { link: "https://cdn.cliente/a.jpg" } },
            ],
          },
          { type: "body", parameters: [{ type: "text", text: "A-1024" }] },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "0",
            parameters: [{ type: "payload", payload: "TRACK_ORDER" }],
          },
        ],
      },
      es
    )

    expect(display?.values).toEqual(["A-1024"])
  })

  it("pinta la burbuja igual cuando la plantilla no tiene variables", () => {
    // Una plantilla sin variables no lleva `components` —el builder ni siquiera
    // manda el campo—. La burbuja se queda con la etiqueta sola, que ya es más
    // que la burbuja en blanco que el ticket prohíbe.
    expect(toTemplateDisplay({ name: "hello", language: "es" }, es)).toEqual({
      label: "plantilla · hello · es",
      values: [],
    })
  })

  it("no inventa huecos cuando vinieron menos parámetros de los que el cuerpo pide", () => {
    // **El caso que el ticket pide cubrir explícitamente, y el que explica por
    // qué esto no es sustitución de variables.** Sin el cuerpo aprobado no
    // sabemos cuántos marcadores tenía: no hay forma de detectar que faltan, y
    // menos de dibujar un `{{2}}` vacío. Se pinta lo que se envió.
    //
    // Ese envío además no llega vivo al hilo: Meta lo rechaza con 132000 y la
    // fila queda `failed`. La burbuja muestra lo que se intentó, que es lo que
    // uno quiere ver cuando está averiguando por qué falló.
    const display = toTemplateDisplay(
      {
        name: "order_update",
        language: "es",
        components: [
          { type: "body", parameters: [{ type: "text", text: "A-1024" }] },
        ],
      },
      es
    )

    expect(display).toEqual({
      label: "plantilla · order_update · es",
      values: ["A-1024"],
    })
  })

  it("degrada sin romperse ante components de una forma que no reconoce", () => {
    // `components` viaja tal cual hacia Meta y nadie lo valida por el camino
    // (ADR 0014), así que en la columna puede haber cualquier cosa. Una burbuja
    // rota es peor que una burbuja parcial: lo ilegible se descarta y la
    // etiqueta sobrevive siempre.
    const label = "plantilla · order_update · es"

    expect(toTemplateDisplay({ ...ORDER_UPDATE, components: [] }, es)).toEqual({
      label,
      values: [],
    })
    expect(
      toTemplateDisplay({ ...ORDER_UPDATE, components: "no soy una lista" }, es)
    ).toEqual({ label, values: [] })
    expect(
      toTemplateDisplay(
        { ...ORDER_UPDATE, components: [{ inventado: true }, null, 7] },
        es
      )
    ).toEqual({ label, values: [] })
    expect(
      toTemplateDisplay(
        {
          ...ORDER_UPDATE,
          components: [{ type: "body", parameters: [{ type: "text" }, 3] }],
        },
        es
      )
    ).toEqual({ label, values: [] })
  })

  it("pinta los valores de un componente cuyo tipo no conoce", () => {
    // No se filtra por `type` de componente: si Meta agrega uno, sus valores se
    // siguen viendo. Filtrar por una lista de tipos conocidos los haría
    // desaparecer en silencio, que es la falla que nadie reporta.
    const display = toTemplateDisplay(
      {
        ...ORDER_UPDATE,
        components: [
          { type: "carousel_card", parameters: [{ type: "text", text: "Ya" }] },
        ],
      },
      es
    )

    expect(display?.values).toEqual(["Ya"])
  })

  it("sigue pintando la burbuja aunque falten nombre o idioma", () => {
    // No debería pasar —la ruta de envío escribe los tres campos— pero la
    // columna es jsonb y no tiene check: si el nombre o el idioma no se pueden
    // leer, la burbuja se pinta con lo que quede en vez de volver a quedarse
    // en blanco.
    expect(toTemplateDisplay({ name: "order_update" }, es)?.label).toBe(
      "plantilla · order_update"
    )
    expect(toTemplateDisplay({ language: "es" }, es)?.label).toBe(
      "plantilla · sin nombre · es"
    )
    expect(toTemplateDisplay({}, es)?.label).toBe("plantilla · sin nombre")
    expect(toTemplateDisplay({}, en)?.label).toBe("template · unnamed")
  })

  it("no es una plantilla lo que ni siquiera es un objeto", () => {
    // El jsonb puede llegar como string si algún día cambia el driver, o venir
    // de un fixture mal armado. Nada de esto lanza.
    expect(toTemplateDisplay('{"name":"order_update"}', es)).toBeNull()
    expect(toTemplateDisplay([ORDER_UPDATE], es)).toBeNull()
    expect(toTemplateDisplay(42, es)).toBeNull()
  })
})

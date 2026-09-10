---
status: accepted
---

# Inbox al mock

Fecha: 2026-09-08. Base de diseño: `Resender Redesign.dc.html` (raíz del repo, sin trackear),
pantallas `1h` (Inbox — Mensajes) y `1i` (Inbox — Comentarios). Sigue a la
[ADR 0017](0017-header-de-consola-y-conexiones-al-mock.md) con el mismo formato de entrega: PR
único sobre `dev`, sin issue.

## Contexto

Inbox seguía con la anatomía de la [ADR 0005](0005-console-redesign-v2-scope-shell-tokens-and-language.md):
eyebrow mono, título de 26 px, pestañas subrayadas, filtro de cuenta en píldoras y los dos paneles
dentro de una tarjeta redondeada con `calc(100svh-16rem)` de alto. El mock los dibuja a sangre
completa junto al sidebar: lista de 380 px con cabecera de 52 px («Inbox», total y píldora «solo
lectura»), fila de controles, e hilo con cabecera propia de 52 px, burbujas sobre fondo hundido y
franja al pie que remite a la API de envío.

El mock es inconsistente entre sus dos pantallas: `1h` lleva buscador y dos desplegables (cuentas,
plataformas) sin pestañas; `1i` lleva buscador, píldoras Mensajes/Comentarios y un desplegable de
cuenta.

## Decisiones

### Header de consola se queda; los paneles van a sangre debajo

El mock no dibuja el header con breadcrumb en Inbox. Se conserva por consistencia con Conexiones y
Ajustes (ADR 0017), y los dos paneles ocupan lo que queda del `main` sin tarjeta ni padding. Para
eso el padding de página (`px-6 pt-7 pb-8`) sale del layout y pasa a `ConsolePage`, que lo piden
Conexiones, Elegir páginas y Ajustes. Coste asumido: 104 px de cabeceras apiladas, no es pixel
perfect en ese punto.

### Una sola fila de controles, la de `1i`, en los dos modos

Píldoras Mensajes/Comentarios a la izquierda y desplegable de cuenta a la derecha, en ambas
pestañas. Las píldoras van sin contador: el modo que no está abierto no se consulta. El filtro por
plataforma no se dibuja: no existe (deuda de la ADR 0015) y un desplegable decorativo confunde.

### Sin buscador

El buscador del mock no se dibuja. Sigue como deuda declarada en la 0015: hoy la lista carga todo
sin paginar y un filtro en cliente sería barato, pero la entrega es solo UI. La fila de píldoras
sube a ocupar su sitio.

### El desplegable de cuenta es el Combobox de shadcn

`Popover` + `Command` (cmdk), nuevas primitivas en `packages/ui` con la dependencia `cmdk`. Es la
única isla cliente de la pantalla: al elegir navega con `inboxHref`, así que el estado sigue en
`?page=` y recarga, compartir y botón atrás siguen funcionando. Rechazado: `DropdownMenu` con
enlaces (mismo aspecto, sin primitiva nueva) y `Select` (no navega solo). Arturo pidió el Combobox
expresamente. `Select` sigue pendiente de la 0015.

### «Abrir en Instagram» solo en Comentarios

En Mensajes no se dibuja el botón aunque el mock lo tenga: sigue como deuda de la 0015. En
Comentarios se conserva el enlace al permalink que ya existía, ahora como botón `outline` en la
cabecera del hilo.

### Miniatura de publicación como placeholder

El webhook no trae `thumbnail_url`; el cuadrado de 44 px del mock se dibuja gris con un icono
según `media_product_type` (feed, reel, historia, anuncio). Traer la miniatura de Graph (caché de
`instagram_media`, `remotePatterns`) queda como deuda.

### Metadato de burbuja con el copy del mock, sin el «POST»

`entrante · 14:01` y `respuesta · 14:02 · entrega: leído`. La dirección se traduce y el `status`
interno deja de imprimirse: el fallo se lee en `entrega: no entregado`, que ahora se pinta también
en Messenger e Instagram cuando el saliente falló aunque Meta no reporte entrega. Se pierden los
segundos. El «POST» del mock es el verbo HTTP de la API, un dato constante: no va. En Comentarios
el entrante lleva a su autor (`@lau.mtz · 09:02`) y el propio dice `respuesta pública · 09:10`; el
metadato va encima de la burbuja, como en `1i`.

### Franja «solo lectura»

La píldora pasa de la cabecera del hilo a la cabecera de la lista. En Mensajes el hilo cierra con
la franja del mock («Las respuestas salen por la API externa…» y «Ver la API de envío» a `/docs`).
En Comentarios no hay franja, como en `1i`.

## Consequences

- Solo UI: mismos `searchParams`, mismas lecturas, mismo contrato de `inboxHref`. Los view-models
  ganan campos (`accountLabel`, `previewPrefix`, `failedLabel`, `mediaTitle`, `mediaKind`…) y el
  metadato cambia de forma; los tests de `lib/` se actualizan.
- Primitivas nuevas: `Popover`, `Command`. Dependencia nueva: `cmdk`.
- Modo oscuro por tokens (`--surface-sunken`, `--border-subtle`, `--border-faint`, burbujas). Sin
  trabajo responsive por debajo de 1280 px, igual que antes.
- Deuda: buscador, filtro de plataforma y «Abrir en Instagram» en Mensajes (0015); miniatura real
  de publicación; sidebar al mock (0017); `Select`, `ToggleGroup`, `Avatar`, `Tooltip`,
  `ScrollArea` (0015).

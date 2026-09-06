---
status: accepted
---

# Paleta neutra + violeta: enmienda a la ADR 0005 en tokens y alcance del sitio público

Fecha: 2026-09-06. Base de diseño: `Resender Redesign.dc.html` (raíz del repo, sin trackear),
cabecera «Paleta neutra, HK Grotesk Pro + Inter + Space Mono, radio 16px». Reemplaza a la
entrega en stack del issue #103 (PRs #109–#113, cerrados sin mergear): esta ADR cubre **solo el
esquema de colores**; shell y primitivas quedan como deuda (ver Consequences).

## Contexto

La [ADR 0005](0005-console-redesign-v2-scope-shell-tokens-and-language.md) fijó tokens arena
(crema de fondo, neutros cálidos, semánticas terrosas) con alcance solo consola: de `/login`
hacia adentro. El mock de septiembre pasa a **neutro + violeta `#7673A4`**: fondo blanco, texto
`#252525`, bordes `#e5e5e5`, semánticas en las rampas estándar de Tailwind (`green`, `amber`,
`red`, `blue`), radio base 8 px y tarjetas a 16 px.

El mock expone el violeta como `var(--accent)` con un selector en runtime. En Resender ese color se
llama **Primario** (`CONTEXT.md`): «acento» en shadcn es el gris de hover de menús y listas, y
renombrar `--accent` pelea contra cada `shadcn add` futuro.

## Considered Options

### Tokens

- **(a) Aislar los tokens nuevos bajo un selector de consola** y dejar el landing en arena.
  Rechazado: dos capas de tokens en `globals.css` y decidir a qué capa pertenece cada componente
  de `packages/ui` que comparten consola y marketing. La 0005 ya rechazó exactamente esto.
- **(b) Neutral por defecto de shadcn pisando solo `primary`.** Rechazado: el mock deja de ser la
  referencia exacta y el `#0a0a0a` sobre blanco de shadcn es más duro que el `#252525` del mock.
- **(c) Valores exactos del mock en una sola capa — elegido.** `globals.css` toma los hex del mock
  tal cual, en `:root, .light`, y todas las pantallas repintan sin tocar su código. Se conservan
  los nombres derivados (`--surface-*`, `--text-*`, `--*-soft`, `--chart-*`, `--bubble-*`): solo
  cambian los valores. Entra `--text-secondary` (`#525252`) porque el mock usa cuatro grises de
  texto y shadcn solo nombra dos. Coste explícito: el sitio público pierde la crema y los tonos
  terrosos de la 0005.

### Modo oscuro

- **(a) Quitarlo.** Rechazado: quien lo usa lo pierde y deja `next-themes` y el interruptor muertos.
- **(b) Dejar la tinta violeta actual.** Rechazado: un claro neutro frío junto a un oscuro cálido
  con matiz violeta parecen dos productos.
- **(c) Reescribir `.dark` con los neutros de shadcn — elegido.** `#0a0a0a` de fondo, `#171717`
  de tarjeta, `#262626` de borde/muted/accent, el mismo violeta, semánticas en tonos 400 sobre
  tintes apoyados en `#171717`. No hay mock: se diseña en código y se revisa a mano.

### Bloques de código

- **(a) Mantener `github-light`/`github-dark`.** Rechazado: traen azules y rojos ajenos a la
  paleta; el hero de la landing sería la única pantalla con colores propios.
- **(b) `min-light`/`min-dark` — elegido.** Monocromos, como el código del mock, sin escribir un
  tema propio.

### Alcance

- **(a) Solo consola, como la 0005.** Rechazado: los tokens son compartidos y el landing cambiaría
  de color igual; fingir que no está en el alcance deja el sitio público a medio hacer.
- **(b) Todas las rutas — elegido.** Contra el mock donde existe (landing, pricing, acceso,
  billing, conexiones, inbox, ajustes) y, en el resto (blog, vs-manychat, waitlist, legales, 404),
  que nada quede roto.

## Decisión

Enmienda a la ADR 0005 en **tokens y alcance**: paleta neutra + violeta con los valores exactos
del mock, en una sola capa, `.dark` sobre los neutros de shadcn, tarjetas a 16 px, Shiki
monocromo, y el sitio público dentro del alcance. Solo color: no cambia layout, sidebar, ni
ninguna primitiva; ninguna regla de negocio, acción, query ni contrato de API.

La 0005 sigue vigente en todo lo demás: sidebar propio de 240 px, PSID como identidad del
contacto, dos planes, pestañas de Ajustes en la URL, barra de cuota global, español en la consola.

## Consequences

- Todo el sitio cambia de color en una sola entrega; las rutas se revisan a mano en claro y oscuro.
- La tarjeta social (`lib/og.tsx`) espeja la paleta nueva: cambia la imagen de todas las rutas.
- **Deuda declarada**, fuera de esta enmienda: shell con el bloque `Sidebar` de shadcn y header con
  `Breadcrumb`; reemplazo de primitivas a mano por shadcn (`Alert`, `AlertDialog`, `Checkbox`,
  `Select`, `ToggleGroup`, `Avatar`, `Tooltip`, `ScrollArea`); **Logs** (`1o`/`1n`), buscador y
  filtro de plataforma de Inbox, «Abrir en Instagram» y «Último uso» de API keys. Los PRs
  #109–#113 quedan como referencia para rescatar piezas.

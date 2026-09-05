---
status: accepted
---

# UI neutra + violeta sobre shadcn: enmienda a la ADR 0005 en tokens, shell y alcance

Fecha: 2026-09-04. Base de diseño: `Resender Redesign.dc.html` (raíz del repo), cabecera «Paleta
neutra, HK Grotesk Pro + Inter + Space Mono, radio 16px». Se implementa en un stack de capas a
partir del issue #103; esta ADR la escribe la capa 1 (#104).

## Contexto

La [ADR 0005](0005-console-redesign-v2-scope-shell-tokens-and-language.md) fijó tokens arena
(crema de fondo, neutros cálidos, semánticas terrosas), un sidebar propio de 240 px escrito a mano
y «sin log de entregas», con alcance solo consola: de `/login` hacia adentro.

El mock `Resender Redesign.dc.html` (2026-09) cambia tres cosas a la vez:

- La paleta pasa a **neutro + violeta `#7673A4`**: fondo blanco, texto `#252525`, bordes `#e5e5e5`,
  y las semánticas son las rampas estándar de Tailwind (`green`, `amber`, `red`, `blue`).
- El alcance **incluye landing y pricing**, no solo la consola.
- **Toda primitiva de UI es de shadcn**: sidebar, breadcrumb, avatar, tooltip, alert, alert-dialog,
  checkbox, select, toggle-group, scroll-area, además de las que ya había.

## Considered Options

### Tokens

- **(a) Aislar los tokens nuevos bajo un selector de consola** y dejar el landing en arena.
  Rechazado: dos capas de tokens en `globals.css` y, peor, decidir a qué capa pertenece cada
  componente de `packages/ui` que comparten consola y marketing. La 0005 ya rechazó exactamente
  esto.
- **(b) Neutral por defecto de shadcn pisando solo `primary`.** Rechazado: el mock deja de ser la
  referencia exacta y el contraste del neutral de shadcn (`#0a0a0a` sobre blanco) es más duro que el
  `#252525` del HTML.
- **(c) Valores exactos del mock en una sola capa — elegido.** `globals.css` toma los hex del mock
  tal cual, en `:root, .light`, y todas las pantallas repintan sin tocar su código. Coste explícito:
  el sitio público pierde la crema y los tonos terrosos de la 0005.

### Modo oscuro

- **(a) Quitarlo.** Rechazado: quien lo usa lo pierde y deja `next-themes` y el interruptor muertos.
- **(b) Dejar la tinta violeta actual.** Rechazado: un claro neutro frío junto a un oscuro cálido con
  matiz violeta no son la misma familia; parecen dos productos.
- **(c) Reescribir `.dark` con los neutros de shadcn — elegido.** `#0a0a0a` de fondo, `#171717` de
  tarjeta, `#262626` de borde/muted/accent, el mismo violeta, y las semánticas en tonos 400 con
  tintes suaves apoyados sobre `#171717`. No hay mock: se diseña en código y se revisa a mano.

### Shell

- **(a) `aside` propio restilizado.** Rechazado: contradice «reutiliza antes de crear» y obliga a
  mantener a mano lo que el bloque `Sidebar` de shadcn ya resuelve (grupos, items, footer, tokens
  `--sidebar-*`).
- **(b) Bloque `Sidebar` de shadcn con `collapsible="none"` — elegido.** Ancho fijo de 232 px por
  `--sidebar-width`, grupos `CONSOLA` y `RECURSOS`, footer con tema e identidad. El colapso, los
  atajos de teclado y la variante móvil del bloque no se activan: el mock es solo escritorio.
  Aparece además un header de 52 px con `Breadcrumb` «Consola › {pantalla}» y un hueco de acciones
  que cada pantalla rellena por contexto (`HeaderActions`).

### Alcance

- **(a) Todo el mock, incluido Logs.** Rechazado: Logs es una feature nueva sin datos detrás.
  `external_webhook_deliveries` cubre solo Webhook → bot; no hay registro API → Meta, ni p95, ni
  polling.
- **(b) Solo consola, como la 0005.** Rechazado: los tokens son compartidos y el landing cambiaría
  de color igual; fingir que no está en el alcance solo deja el sitio público a medio hacer.
- **(c) Consola + sitio público, sin Logs — elegido.**

## Decisión

Enmienda a la ADR 0005 en **tokens, shell y alcance**:

- Tokens: paleta neutra + violeta con los valores exactos del mock, en una sola capa, con `.dark`
  reescrito sobre los neutros de shadcn. Se conservan todos los nombres de variables derivadas
  (`--surface-*`, `--text-*`, `--info-*`, `--chart-*`, `--bubble-*`): solo cambian los valores.
- Shell: bloque `Sidebar` de shadcn sin colapso, header con breadcrumb y hueco de acciones.
- Alcance: consola y sitio público. Logs queda fuera.

La 0005 sigue vigente en todo lo demás: PSID como identidad del contacto, dos planes, pestañas de
Ajustes en la URL, barra de cuota global, español en la consola, etc.

## Consequences

- El sitio público cambia de color en toda su superficie aunque todavía no esté restilizado; las
  capas siguientes del stack lo alinean pantalla a pantalla.
- El vocabulario gana **Consola** como raíz del breadcrumb y primer grupo del menú (ver
  `CONTEXT.md`).
- Deuda declarada, fuera de esta enmienda: **Logs** (y su item de menú), buscador y filtro de
  plataforma de Inbox, «Abrir en Instagram» y «Último uso» de API keys. Cada una necesita datos o
  endpoints que hoy no existen.

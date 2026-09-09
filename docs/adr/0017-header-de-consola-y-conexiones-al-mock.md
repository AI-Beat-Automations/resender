---
status: accepted
---

# Header de consola y pantallas de Conexiones al mock

Fecha: 2026-09-08. Base de diseño: `Resender Redesign.dc.html` (raíz del repo, sin trackear),
pantallas `1e` (Conexiones con datos), `1f` (Conexiones vacío) y `1g` (Elegir páginas). Salda
parte de la deuda declarada en la [ADR 0015](0015-paleta-neutra-violeta.md): el header del shell
y cuatro primitivas de shadcn. El sidebar sigue como deuda.

## Contexto

La ADR 0015 metió solo la paleta. Las tres pantallas de Conexiones seguían con la anatomía de
la [ADR 0005](0005-console-redesign-v2-scope-shell-tokens-and-language.md): eyebrow mono,
botones de conectar junto al título, alerts y checkbox a mano, diálogo de desconexión en
`Dialog`. El mock las dibuja con un header de 52 px (breadcrumb + acciones de la pantalla), una
columna de 880 px (720 en la selección), tarjetas de 16 px con avatar de canal, alerts
inline, `Checkbox` y `AlertDialog`.

## Decisiones

### Header global en el shell, por slot paralelo

El header de 52 px vive en `app/(product)/layout.tsx` y lo rellena el slot paralelo `@header`:
cada ruta tiene su `page.tsx` bajo `@header/…` que devuelve `ConsoleHeader` con su miga y sus
acciones. Inbox y Ajustes lo heredan sin acciones.

Rechazado: portal desde la página hacia un hueco del header (`createPortal` tras montar). Las
acciones aparecerían después de hidratar, y para pixel perfect el primer pintado cuenta.
Rechazado también: header local a Conexiones. Dejaba la consola inconsistente hasta migrar el
resto.

Las lecturas que el header repite con la página (`listTenantPages`, `resolveChannelAccess`)
van por `React.cache` en `features/connections/queries.ts`, sin tocar `lib/`.

### Sidebar fuera de alcance

El mock también redibuja el sidebar (marca «r», grupos CONSOLA/RECURSOS, tarjeta de usuario).
Queda como deuda: se abre issue aparte.

### Token inválido conserva el cuerpo

En el mock, la tarjeta con token inválido solo muestra el aviso con «Reconectar». Se conserva
el cuerpo de webhook y secreto debajo del aviso: ocultarlo cambiaría lo que el usuario puede
hacer, y esta entrega es solo UI.

### WhatsApp: franja propia entre cabecera y cuerpo

El bloque de WhatsApp (alta, token, suscripción, historial, PIN, límites de Coexistence) no
está en el mock. Va como sección con su divisor entre la cabecera y el webhook, con los paneles
al estilo de los alerts del mock. El historial tiene reloj de 24 h y no baja al fondo
(ADR 0005).

### Primitivas nuevas en `packages/ui`

`Alert`, `AlertDialog`, `Checkbox` y `Breadcrumb`, escritas a mano en el estilo `radix-nova`
del resto. La desconexión pasa de `Dialog` a `AlertDialog` con el mismo copy: el mock no dibuja
confirmación, pero desconectar es destructivo. El `Checkbox` de la selección lleva la misma
`name="pageIds"` y `value` que el nativo: Radix emite el `<input>` oculto y la server action
recibe lo mismo.

### Tokens

Se añade `--border-faint` (`#f0f0f0` claro, `#1f1f1f` oscuro) para los divisores internos de
tarjeta y de lista. El texto de la barra de cuota usa `--warning-soft-foreground` y no el
`#78350f` del mock: los tokens semánticos mandan sobre un hex suelto.

### Botones «Conectar…»

Orden Facebook, Instagram, WhatsApp en el header y en las tarjetas del vacío, como el código
actual. El mock los pone en otro orden en el header; se trata como descuido. En el vacío el
header no lleva acciones. El launcher de WhatsApp gana un `layout` (`stack`, `card`, `header`):
en el header, lo que tenga que decir se despliega en un panel bajo el botón.

## Consequences

- Solo UI: mismas acciones, mismos `searchParams`, mismos textos de error de Meta, mismo cupo
  fail-closed.
- El padding horizontal del `main` pasa de 36 a 24 px para todas las rutas de la consola.
- Deuda: sidebar al mock; `Select`, `ToggleGroup`, `Avatar`, `Tooltip` y `ScrollArea` siguen
  pendientes de la 0015.

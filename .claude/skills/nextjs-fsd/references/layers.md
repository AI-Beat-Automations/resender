# Capas, slices y segmentos: referencia de decisión

Fuente: referencia oficial de FSD (Layers, Slices and segments, Public API, Cross-imports, Slice groups, Excessive Entities, Desegmentation, migración v2.1).

## Regla de imports entre capas

> Un módulo (archivo) de un slice solo puede importar otros slices cuando están en capas **estrictamente inferiores**.

Ejemplo: `~/features/aaa/api/request.ts` no puede importar nada de `~/features/bbb`, pero sí de `~/entities` y `~/shared`, y también cualquier código hermano de `~/features/aaa` (p. ej. `~/features/aaa/lib/cache.ts`).

**Excepciones:** las capas App y Shared son a la vez capa y slice (no tienen dominios de negocio), están compuestas de segmentos, y sus segmentos pueden importarse libremente entre sí.

Cuanto más abajo está la capa, más peligroso y responsable es cambiarla (más código depende de ella). Cuanto más arriba, más contexto tiene.

## Definiciones de capa

### Shared

Fundación del resto de la app. Conexiones con el mundo exterior (backends, librerías third-party, entorno) y librerías internas propias muy contenidas. Sin slices ni lógica de negocio. Segmentos típicos:

- `api` — el API client y opcionalmente funciones de request a endpoints concretos del backend.
- `ui` — el UI kit. Sin lógica de negocio, pero puede ser business-themed (logo, layout de página). Se permite UI logic (autocomplete, search bar).
- `lib` — colección de librerías internas, **no** un cajón de helpers/utilities. Cada librería tiene un área de foco (dates, colors, text manipulation) documentada en un README.
- `config` — variables de entorno, feature flags globales, configuración global.
- `routes` — constantes o patrones de rutas.
- `i18n` — setup de traducciones, strings globales.

Se pueden añadir segmentos, siempre nombrados por propósito, no por esencia (`components`, `hooks`, `types` son malos nombres).

En Next.js además: segmento `db` para queries a base de datos, y `auth` para datos de autenticación si `api` se satura.

### Entities

Conceptos del mundo real con los que trabaja el proyecto — los términos que el negocio usa para describir el producto (User, Post, Group). Un slice de entity puede contener storage y schemas de validación (`model`), requests de API (`api`) y la representación visual reutilizable (`ui`) — que no tiene que ser un bloque completo de UI: la lógica de negocio se le adjunta desde arriba vía props/slots.

Cómo mantener la capa limpia ("Excessive Entities"):

0. **Considera no tener capa entities.** No rompe FSD. Un cliente *thin* (el backend procesa casi todo) probablemente no la necesita.
1. **Evita el slicing preventivo** (v2.1: descomposición diferida). Empieza con el código en el `model` de la página/widget/feature; extráelo a entities cuando los requisitos estén estables. Cuanto más tarde muevas código a entities, menos peligrosos los refactors.
2. **Evita entities innecesarias.** Usa los tipos de `shared/api` y coloca la lógica en el `model` del slice actual. Para lógica de negocio reutilizable, `model` dentro de la entity, con las definiciones de datos en `shared/api`.
3. **El CRUD va en `shared/api`** (`shared/api/endpoints/order.ts`…), no en entities. Solo operaciones complejas (updates atómicos, rollbacks, transacciones) podrían justificar entities, con cautela.
4. **Datos de autenticación en `shared`** (`shared/auth`, `shared/api`), no en una entity `user`: las respuestas de auth son contextuales y poco reutilizables.
5. **Minimiza cross-imports** diseñando entities como contextos de negocio aislados (una entity `order-info` que encapsula items y customer info, en vez de tres entities acopladas con `@x`).

### Features

Las interacciones principales de la app: lo que los usuarios quieren hacer, generalmente con las entities. Principio crucial: **no todo necesita ser una feature**. Buen indicador: se reutiliza en varias páginas. Si hay demasiadas features, las importantes se ahogan. Optimiza para que un recién llegado descubra las grandes áreas importantes mirando pages y features. Segmentos típicos: `ui` (el formulario/control), `api` (las llamadas de la acción), `model` (validación y estado interno), `config` (feature flags).

### Widgets

Bloques grandes y autosuficientes de UI, normalmente un caso de uso completo. Útiles cuando se reutilizan en varias páginas, o cuando una página tiene varios bloques grandes independientes. **Si un bloque es la mayor parte del contenido de una página y no se reutiliza, NO es un widget** — va dentro de la página. Con nested routing (estilo Remix), la capa Widgets puede usarse como una capa Pages plana: bloques de router completos con data fetching, loading states y error boundaries. También pueden vivir aquí los layouts de página.

### Pages

Pantallas completas o partes grandes en nested routing. Una página = un slice; páginas muy similares pueden agruparse en un slice (registro + login). Sin límite de código mientras el equipo navegue fácil: bloques no reutilizados se quedan dentro. Contenido típico: `ui` (la página, loading states, error boundaries), `api` (fetching y mutaciones). No es común que una página tenga data model propio; trocitos de estado viven en los componentes.

### App

Todo lo que concierne a la aplicación completa, técnico (providers, router) y de negocio (analytics). Sin slices; segmentos directos: `routes` (configuración del router), `store` (store global), `styles` (estilos globales), `entrypoint` (punto de entrada, framework-specific). En Next.js: + `api-routes`, + `layouts` opcional. Los ambient declaration files (`*.d.ts`) pueden ir en `app/ambient/`.

### Processes — deprecada. No usar; mover contenido a `features` y `app`.

## Slices

- Agrupan por significado para producto/negocio. Nombres no estandarizados (los determina el dominio: `photo`, `effects`, `gallery-page` / `post`, `comments`, `news-feed`).
- Objetivo: **zero coupling** entre slices de la misma capa, **high cohesion** dentro de cada slice.
- Un slice no puede usar otro slice de su misma capa.
- La composición de slices se hace en capas superiores (una página compone features; un widget puede recibir una feature dentro de otra vía props/children).

### Slice groups

Slices relacionados pueden agruparse estructuralmente en una carpeta (`entities/payment/{invoice,receipt,transaction}`, `pages/order/{create,detail,list}`):

- El grupo **no es un slice**: no tiene segmentos, ni public API, ni `index.ts` propio.
- **Cero código compartido dentro de la carpeta de grupo.** Las reglas de aislamiento entre slices no cambian.
- Introducirlos solo cuando el criterio de agrupación es obvio y la capa creció demasiado para leerse de un vistazo. No todo slice necesita grupo.
- En `features` son posibles pero más difíciles de justificar; vigila que no se convierta en el hogar de todo un dominio (eso pertenece a entities).

## Public API

- Contrato del slice con el exterior: `index.ts` con re-exports explícitos.
- Objetivos: proteger al resto de la app de refactors internos; que los cambios de comportamiento que rompen expectativas se reflejen en la public API; exponer **solo lo necesario**.
- **Prohibido `export *`** (wildcard re-exports): mata la descubribilidad y expone internals accidentalmente.
- En Shared: public API **por segmento** (`shared/ui`, `shared/api`…), no un index único de todo Shared. Y dentro de `shared/ui`/`shared/lib`, un index **por componente/librería** para no romper tree-shaking ni engordar bundles (`import { Button } from '@/shared/ui/button'`).
- Evitar index files en los segmentos de capas con slices (no `features/comments/ui/index.ts`).
- Imports circulares: dentro del mismo slice usar imports **relativos con ruta completa**; entre slices, imports **absolutos con alias**. Nunca importar el propio `index.ts` del slice desde dentro del slice.
- Los index no protegen de verdad contra deep imports (los auto-imports del IDE pueden saltárselos): usar Steiger para detectarlo.
- Proyectos muy grandes: dividir en varios paquetes de monorepo, cada uno una raíz FSD con sus propias capas.

## Cross-imports

Import entre slices de la misma capa: **code smell** — señal de acoplamiento. Señales de alerta: depender del store/model de otro slice, deep imports a archivos internos ajenos, dependencias bidireccionales, cambios en un slice que rompen otro con frecuencia.

Estrategias (en orden de preferencia):

- **A. Fusionar slices** que siempre cambian juntos (`features/profile` + `features/profileSettings` → `features/profile`).
- **B. Bajar el flujo de dominio compartido a `entities`** (solo tipos y lógica de dominio; la UI se queda en features/widgets). Ej.: validación de sesión usada por `features/auth` y `features/profile` → `entities/session`.
- **C. Componer desde una capa superior** (pages/app) con Inversión de Control: render props (React), slots (Vue), inyección por props/context. La página inyecta `<UserAvatar>` en `<CommentList renderUserAvatar={...}>` en vez de que commentList importe userProfile.
- **D. Si es inevitable: solo vía public API explícita** del otro slice (hooks/componentes exportados), jamás a `features/auth/model/internal/*`. Documentar la decisión y revisitarla.

### Notación `@x` (solo entities)

Public API especial para cross-imports entre entities cuyos dominios se referencian inevitablemente:

```
entities/
└── song/
    ├── @x/
    │   └── artist.ts   ← public API solo para entities/artist
    └── index.ts        ← public API normal
```

```ts
// entities/song/@x/artist.ts
export type { Song } from "../model/song.ts";
```

```ts
// entities/artist/model/artist.ts
import type { Song } from "entities/song/@x/artist";

export interface Artist {
  name: string;
  songs: Array<Song>;
}
```

`A/@x/B` se lee "A crossed with B". Mantener los cross-imports al mínimo y usar esta notación **solo en la capa entities**, como último recurso (antes considera fusionar las entities). Alternativa: parametrizar los tipos (`interface Song<ArtistType extends { id: string }>`).

## Desegmentación (antipatrón)

Agrupar archivos por rol técnico en vez de por dominio:

```
❌ components/ actions/ composables/ constants/ utils/ stores/
❌ features/delivery/ui/components/
❌ entities/recommendations/utils/
❌ pages/delivery/model/types.ts  (mezcla DeliveryOption y UserInfo)
❌ pages/delivery/model/utils.ts  (mezcla formatDeliveryPrice y getUserInitials)
```

Problemas: baja cohesión (tocar una feature obliga a editar varias carpetas grandes), acoplamiento, refactors difíciles.

Solución: agrupar todo el código de un dominio junto y nombrar archivos por dominio:

```
✅ pages/delivery/model/delivery.ts
✅ pages/delivery/model/user.ts
```

## Adopción incremental (migración de arquitectura custom)

1. Formar lentamente las capas App y Shared módulo a módulo.
2. Distribuir toda la UI existente entre Widgets y Pages a brochazos, aunque violen reglas al principio.
3. Resolver gradualmente las violaciones de imports y extraer Entities y quizá Features.

Evitar añadir entities grandes nuevas durante el refactor. Copy-paste no es arquitectónicamente incorrecto (a veces es mejor duplicar que abstraer), pero no duplicar lógica de negocio.

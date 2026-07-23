# FSD + Next.js: guía de integración completa

Fuente: guía oficial "Usage with Next.js" de la documentación de Feature-Sliced Design.

## El conflicto

Next.js usa la carpeta `app` para el App Router y la carpeta `pages` para el Pages Router, lo que colisiona con los nombres de las capas FSD `app` y `pages`.

**Regla oficial (Caution de la doc):** para evitar conflictos, renombra **ambas** capas FSD `app` y `pages` a `_app` y `_pages`, **independientemente del router que uses**. Este enfoque es compatible con el linter oficial (Steiger).

## Carpeta `src`

Next.js espera las carpetas especiales `app` o `pages` en la raíz del proyecto o dentro de `src`. Generalmente es más fácil colocar las carpetas de Next.js **en la raíz del proyecto**, de modo que `src` contenga únicamente código FSD — aunque no es obligatorio.

## App Router

Estructura de referencia:

```
app/                          ← carpeta app de Next.js (solo routing)
├── api/
│   └── get-example/
│       └── route.ts
└── example/
    └── page.tsx
src/
├── _app/                     ← capa FSD app
│   └── api-routes/           ← segmento para API routes
├── _pages/                   ← capa FSD pages
│   └── example/
│       ├── index.ts
│       └── ui/
│           └── example.tsx
├── widgets/
├── features/
├── entities/
└── shared/
```

Re-export de una página desde `src/_pages` en el `app` de Next.js:

```tsx
// app/example/page.tsx
export { ExamplePage as default, metadata } from '@/_pages/example';
```

El archivo de ruta es un *thin entry point*: no contiene lógica, solo re-exporta el componente de página (y sus exports de framework como `metadata`) desde la capa FSD.

### Public APIs de servidor y cliente

En el App Router, módulos usables en cliente y módulos server-only pueden convivir dentro de un mismo slice. Si un módulo server-only se exporta desde `index.ts`, sus side effects de servidor pueden propagarse al grafo de módulos cliente cuando un Client Component importa ese slice, provocando errores de build.

Cuando ese problema ocurre (no de forma preventiva), añade un **`index.server.ts`** a la public API del slice:

- `index.server.ts`: módulos que solo deben importarse en el servidor — Server Components o funciones de acceso a datos marcadas con `server-only`.

(Ver también "Environment-specific Public APIs" en la referencia de Public API: la public API de un slice debe ser `index.ts` en general; separar por entorno solo cuando el problema aparece realmente.)

### Middleware

Si usas middleware, debe estar en la **raíz del proyecto**, junto a las carpetas `app` y `pages` de Next.js. Nunca dentro de `src/`.

### Instrumentation

El archivo `instrumentation.js`/`instrumentation.ts` (monitoreo de rendimiento y comportamiento) también debe estar en la **raíz del proyecto**, igual que `middleware`.

## Pages Router

Las rutas van en la carpeta `pages` en la raíz del proyecto. La estructura dentro de `src` con las capas no cambia:

```
pages/                        ← carpeta Pages de Next.js
├── _app.tsx
├── api/
│   └── example.ts            ← re-export de API route
└── example/
    └── index.tsx
src/
├── _app/                     ← capa FSD app
│   ├── custom-app/
│   │   └── custom-app.tsx    ← componente Custom App
│   └── api-routes/
│       └── get-example-data.ts
├── _pages/                   ← capa FSD pages
│   └── example/
│       ├── index.ts
│       └── ui/
│           └── example.tsx
├── widgets/
├── features/
├── entities/
└── shared/
```

Re-export de una página:

```tsx
// pages/example/index.tsx
export { Example as default } from '@/_pages/example';
```

### Custom `_app`

El componente Custom App se coloca en `src/_app/_app` o `src/_app/custom-app`:

```tsx
// src/_app/custom-app/custom-app.tsx
import type { AppProps } from 'next/app';

export const MyApp = ({ Component, pageProps }: AppProps) => {
    return (
        <>
            <p>My Custom App component</p>
            <Component { ...pageProps } />
        </>
    );
};
```

```tsx
// pages/_app.tsx
export { MyApp as default } from '@/_app/custom-app';
```

## Route Handlers (API routes)

Usa el segmento **`api-routes`** en la capa `_app` para trabajar con Route Handlers.

Advertencia oficial: FSD está pensado principalmente para frontends — eso es lo que la gente espera encontrar. Si necesitas muchos endpoints, considera separarlos en un paquete distinto del monorepo.

### App Router

```tsx
// src/_app/api-routes/get-example-data.ts
import { getExamplesList } from '@/shared/db';

export const getExampleData = () => {
    try {
        const examplesList = getExamplesList();

        return Response.json({ examplesList });
    } catch {
        return Response.json(null, {
            status: 500,
            statusText: 'Ouch, something went wrong',
        });
    }
};
```

```tsx
// app/api/example/route.ts
export { getExampleData as GET } from '@/_app/api-routes';
```

### Pages Router

```tsx
// src/_app/api-routes/get-example-data.ts
import type { NextApiRequest, NextApiResponse } from 'next';

const config = {
    api: {
        bodyParser: {
            sizeLimit: '1mb',
        },
    },
    maxDuration: 5,
};

const handler = (req: NextApiRequest, res: NextApiResponse<ResponseData>) => {
    res.status(200).json({ message: 'Hello from FSD' });
};

export const getExampleData = { config, handler } as const;
```

```tsx
// src/_app/api-routes/index.ts
export { getExampleData } from './get-example-data';
```

```tsx
// pages/api/example.ts
import { getExampleData } from '@/_app/api-routes';

export const config = getExampleData.config;
export default getExampleData.handler;
```

## Recomendaciones adicionales (oficiales)

- Usa el segmento **`db`** en la capa `shared` para describir las queries a base de datos y su uso posterior en capas superiores.
- La lógica de **caching y revalidación** de queries se mantiene en el mismo lugar que las propias queries.

## Alias

Los ejemplos oficiales usan el alias `@/` apuntando a `src/` (p. ej. `@/_pages/example`, `@/shared/db`). Configúralo en `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

Nota para este repo: `apps/web` hoy tiene `app/` en la raíz del paquete y alias `@/*` → `./*` (sin `src/`). Al adoptar FSD aquí, crea `apps/web/src/` con las capas FSD, apunta el alias `@/*` a `./src/*` (o añade un alias dedicado) y deja `apps/web/app/` solo con archivos de ruta que re-exportan desde `src/`.

## Layouts

Según el FAQ y la guía de layouts oficiales:

- Layouts de puro markup → `shared/ui`.
- Layouts que necesitan capas superiores (widgets con lógica) → componerlos en la capa app (`_app/layouts`) o como widgets/páginas compuestas vía el routing. En Next.js App Router, los `layout.tsx` de la carpeta `app/` siguen el mismo patrón que `page.tsx`: archivo fino que re-exporta o compone desde `src/`.
- A veces no necesitas abstraer el layout: si son pocas líneas, duplicarlo en cada página es razonable ("la urgencia de abstraer código suele estar sobrevalorada").

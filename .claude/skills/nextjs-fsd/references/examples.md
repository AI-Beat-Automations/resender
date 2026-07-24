# Ejemplos prácticos

Ejemplos tomados de la documentación oficial de FSD (tutorial Conduit, guías de API requests, tipos, auth y TanStack Query), adaptados a Next.js App Router donde aplica (capas `_pages`/`_app`, alias `@/` → `src/`).

## 1. Slice de página completo

Estructura de una página "feed" con su ruta Next:

```
app/
└── page.tsx                        ← thin route
src/_pages/feed/
├── index.ts                        ← public API del slice
├── ui/
│   ├── FeedPage.tsx
│   ├── ArticlePreview.tsx          ← componente solo de esta página: se queda aquí
│   ├── Tabs.tsx
│   ├── PopularTags.tsx
│   └── Pagination.tsx
└── api/
    └── get-feed.ts                 ← data fetching específico de la página
```

```ts
// src/_pages/feed/index.ts
export { FeedPage } from "./ui/FeedPage";
```

```tsx
// app/page.tsx
export { FeedPage as default } from '@/_pages/feed';
```

Puntos del tutorial oficial que ilustra:

- Cuando el archivo de página crece, se parte en componentes adyacentes dentro del mismo segmento `ui` (Tabs, PopularTags, Pagination) — no se crean widgets ni features para bloques de una sola página.
- Los imports dentro del slice son relativos (`import { ArticlePreview } from "./ArticlePreview"`, `import type { loader } from "../api/loader"`).
- Páginas similares comparten slice: login y registro viven juntos en `_pages/sign-in` (con `SignInPage.tsx` y `RegisterPage.tsx` en `ui`, y sus requests en `api`), re-exportados desde rutas distintas.

## 2. `shared/api`: cliente + endpoints + DTOs + mappers

```
src/shared/api/
├── index.ts
├── client.ts
└── endpoints/
    └── login.ts
```

```ts
// src/shared/api/client.ts
export const client = {
  async post(endpoint: string, body: any, options?: RequestInit) {
    const response = await fetch(`https://your-api-domain.com/api${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(body),
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    return response.json();
  }
};
```

```ts
// src/shared/api/endpoints/login.ts
import { client } from '../client';

export interface LoginCredentials {
  email: string;
  password: string;
}

export function login(credentials: LoginCredentials) {
  return client.post('/login', credentials);
}
```

```ts
// src/shared/api/index.ts
export { client } from './client';
export { login } from './endpoints/login';
export type { LoginCredentials } from './endpoints/login';
```

Si un request solo lo usa un slice, va en el segmento `api` de ese slice (p. ej. `_pages/login/api/login.ts` usando `client` de `shared/api`) y **no** hace falta exportarlo en la public API de la página.

DTOs y mappers viven junto a la request function que los usa:

```ts
// src/shared/api/songs.ts
import type { ArtistDTO } from "./artists";

interface SongDTO {
  id: number;
  title: string;
  disc_no: number;
  artist_ids: Array<ArtistDTO["id"]>;
}

interface Song {
  id: string;
  title: string;
  /** The full title of the song, including the disc number. */
  fullTitle: string;
  artistIds: Array<string>;
}

function adaptSongDTO(dto: SongDTO): Song {
  return {
    id: String(dto.id),
    title: dto.title,
    fullTitle: `${dto.disc_no} / ${dto.title}`,
    artistIds: dto.artist_ids.map(String),
  };
}

export function listSongs() {
  return fetch('/api/songs').then(async (res) => (await res.json()).map(adaptSongDTO));
}
```

Ventaja oficial de mantener requests/DTOs en Shared: los tipos del mundo real se entrelazan y ahí pueden referenciarse libremente. Tipos generados (OpenAPI: orval, openapi-typescript) → `shared/api/openapi` con un README que documente cómo regenerarlos. No colocar API calls y tipos de respuesta en `entities` prematuramente: las respuestas del backend pueden diferir de lo que las entities del frontend necesitan.

## 3. Validación con schemas (Zod)

- Datos del backend → schema junto a la request function (segmento `api`): se falla el request si no matchea.
- Input de usuario (formularios) → schema en `ui` junto al formulario, o en `model` si `ui` está saturado:

```ts
// src/_pages/login/model/registration-schema.ts
import { z } from "zod";

export const registrationData = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});
```

El segmento `ui` importa el schema desde `../model/registration-schema` (relativo, mismo slice).

## 4. Autenticación

- El almacenamiento ideal del token es una **cookie**. Con framework con lado servidor, la infraestructura de sesión server-side va en `shared/api` (ej. del tutorial: `shared/api/auth.server.ts` con `createUserSession`, `getUserFromSession`, `requireUser`).
- Si no hay cookies: token en Shared (estado en el API client, refresh como middleware) o en Entities (store reactivo en `model` de la entity user/viewer). **Nunca** estado app-wide como el token en el `model` de una página o widget.
- Si la gestión del token crece y satura `shared/api`, separarla en `shared/auth`.
- Logout: si los requests viven en `shared/api`, el request de logout va ahí junto al de login; si no, junto al botón que lo dispara (segmento `api` del widget header, con la actualización del store en su `model`).
- Página de login: slice único `_pages/login` (o `sign-in`) con `LoginPage.tsx` y `RegisterPage.tsx` en `ui`. Diálogo de login reutilizable en cualquier página → widget `widgets/login-dialog`.
- 2FA: la página del one-time password se queda en el mismo slice `login`.

## 5. TanStack Query

Dónde guardar las keys/queries — tres opciones oficiales:

1. **En `shared/api/queries/`** (query factories globales).
2. **En `shared/api/<controller>/`** si hay muchos endpoints — un public API por controller (`shared/api/post/index.ts` exporta `POST_QUERIES`).
3. **En `entities/<entity>/api/`** si el proyecto ya está dividido en entities y cada request corresponde a una entity (conexiones entre entities → `@x`).

Query factory con `queryOptions` (react-query v5):

```ts
// src/shared/api/post/post.queries.ts
import { queryOptions } from '@tanstack/react-query';
import { getPosts } from './get-posts';
import { getDetailPost, type DetailPostQuery } from './get-detail-post';

export const POST_QUERIES = {
    all: () => ['posts'],
    lists: () => [...POST_QUERIES.all(), 'list'],
    list: (page: number, limit: number) => queryOptions({
        queryKey: [...POST_QUERIES.lists(), page, limit],
        queryFn: () => getPosts(page, limit),
        placeholderData: prev => prev,   // evita flicker en paginación
    }),
    details: () => [...POST_QUERIES.all(), 'detail'],
    detail: (query?: DetailPostQuery) => queryOptions({
        queryKey: [...POST_QUERIES.details(), query?.id],
        queryFn: () => getDetailPost({ id: query?.id }),
    }),
};
```

Uso: `useQuery(postApi.POST_QUERIES.detail({ id }))` desde el `ui` de una página. Infinite scroll: `infiniteQueryOptions` en la misma factory. Suspense: `useSuspenseQuery` compatible sin cambios; el wrapper `<Suspense>`/`<ErrorBoundary>` va en `app/providers` (aquí: `_app/providers`).

**Mutations: no mezclarlas con queries.** Opciones:

- En el segmento `api` cerca del punto de uso (`_pages/example/api/use-update-example.ts` con `useMutation` + `queryClient.setQueryData`).
- En shared/entities solo la `mutationFn`, y el hook `useMutation` en el componente.
- Mutation keys junto a la query factory (`POST_MUTATIONS`), para leer estado global con `useMutationState` desde otro slice (ej.: `widgets/save-indicator`).

`QueryProvider` (QueryClient con `QueryCache`/`MutationCache` y defaults) → `_app/providers/query-provider.tsx`.

## 6. Tipos

- **Utility types**: librería propia en `shared/lib/utility-types` (con README de qué pertenece ahí) — pero no sobreestimar la reutilización: un utility type usado en un solo sitio vive junto a su uso.
- **Props/context de componentes**: en el mismo archivo del componente.
- **Enums**: lo más cerca posible del uso; segmento según lo que representan (`ui` para posiciones de toast, `api` para estados de request). Solo los verdaderamente globales van a Shared.
- **`*.d.ts` ambient**: en `app/ambient/`; typings de paquetes sin tipos en `shared/lib/untyped-packages/%LIBRARY_NAME%.d.ts`.
- **Prohibido** `shared/types` y segmentos `types`: agrupan por esencia, no por propósito.
- Redux clásico: `RootState`/`AppDispatch` se declaran globales en `app/store` (dependencia implícita aceptada y documentada) y los hooks tipados viven en `shared/store`.

## 7. Assets

| Tipo de asset | Ubicación |
| --- | --- |
| Específicos de un slice | dentro del slice (`_pages/home/ui/hero-image.jpg`, subcarpeta `ui/previews/` si son muchos) |
| Iconos e imágenes reutilizables | `shared/ui/` (junto al componente que los usa: `Dropdown.tsx` + `chevron.svg`) |
| Asset acoplado a lógica de negocio | segmento `model` junto a esa lógica (`features/billing/model/invoice-template.pdf`) |
| Estilos globales | `_app/styles/` (reset.css, global.css) |
| Fuentes, favicon, estáticos | `public/` (no es parte de la estructura FSD; no genera colisiones) |

Antipatrón: segmento `assets` global — viola cohesión y localidad de cambios.

## 8. Composición entre slices (sin cross-imports)

La página compone features independientes:

```tsx
// src/_pages/user-dashboard/ui/UserDashboardPage.tsx
import { UserProfilePanel } from '@/features/userProfile';
import { ActivityFeed } from '@/features/activityFeed';

export function UserDashboardPage() {
    return (
        <div>
            <UserProfilePanel />
            <ActivityFeed />
        </div>
    );
}
```

Render props para invertir la dependencia cuando una feature debe renderizar contenido de otra:

```tsx
// src/features/commentList/ui/CommentList.tsx
interface CommentListProps {
    comments: Comment[];
    renderUserAvatar?: (userId: string) => React.ReactNode;
}

export function CommentList({ comments, renderUserAvatar }: CommentListProps) {
    return (
        <ul>
            {comments.map(comment => (
                <li key={comment.id}>
                    {renderUserAvatar?.(comment.userId)}
                    <span>{comment.text}</span>
                </li>
            ))}
        </ul>
    );
}
```

```tsx
// src/_pages/post/ui/PostPage.tsx
import { CommentList } from '@/features/commentList';
import { UserAvatar } from '@/features/userProfile';

export function PostPage() {
    return (
        <CommentList
            comments={comments}
            renderUserAvatar={(userId) => <UserAvatar userId={userId} />}
        />
    );
}
```

`CommentList` no importa `userProfile`: la página inyecta el avatar.

---
status: accepted
---

# Login y registro vuelven al diccionario (enmienda a la ADR 0005)

La [ADR 0005](0005-console-redesign-v2-scope-shell-tokens-and-language.md) fijó **español
hardcoded en el JSX, sin `dict` ni i18n** para las nueve rutas de producto, y aceptó como
consecuencia que «un inglés futuro reabre las nueve pantallas». Esta ADR **enmienda esa decisión
para dos de las nueve** —`/login` y `/register`— y deja las otras siete intactas.

El motivo es que la versión en inglés del sitio público ya existe y ya linkea ahí. El header de
`/en` apunta a `localePath("/login", lang)` → `/en/login` (`components/site-header.tsx:53`), y
`/login` y `/register` están en `LOCALIZED_ROUTES` (`content/i18n/dictionary.ts:262`), que es lo
que alimenta `hasLocaleTwin()` y por lo tanto el switch ES/EN. No es un inglés «futuro»: es el
que se está mergeando en esta misma rama.

**Login y registro son la puerta entre el sitio público y el producto**, no pantallas de dentro
del dashboard. Un visitante que leyó el landing en inglés y hace click en «Sign up» no debería
aterrizar en español, y el corte natural es exactamente donde termina la sesión anónima.

## Considered Options

- **Borrar `/en/login` y `/en/register`** — rechazado. Es lo más fiel a la 0005 y lo más barato
  (`auth-form.tsx` y `actions.ts` quedan byte-idénticos a los de la consola v2), pero obliga a
  sacar las dos rutas de `LOCALIZED_ROUTES` para que el header de `/en` no dé 404, y deja el
  embudo de conversión en inglés cortado justo en el paso donde se convierte.
- **Llevar las nueve pantallas al diccionario** — rechazado. Es lo que la 0005 descartó con
  argumentos que siguen valiendo: el dashboard no tiene tráfico anónimo, no lo ve Google, y
  meterlo en el `Dict` obliga a mantener paridad ES/EN de decenas de strings que nadie pidió en
  inglés.
- **Mover solo `/login` y `/register` al diccionario** — elegido.

## Decisión

- `/login`, `/register`, `/en/login` y `/en/register` leen su texto del bloque `auth` del `Dict`.
  Las rutas de Next son cáscaras: la vista compartida vive en `features/auth/ui/login-view.tsx` y
  `register-view.tsx`, parametrizada por `lang`.
- **Las otras siete pantallas siguen con español hardcoded**: `/waitlist`, `/billing`,
  `/billing/success`, `/connections`, `/connections/select`, `/messages` y `/settings`. La 0005
  sigue vigente para ellas.
- **El diseño no cambia**: login y registro usan el `AccessShell` de la consola v2 con el mismo
  markup. `AccessShell` y `AccessDocsLink` aceptan un `lang` opcional que por defecto es `es`,
  así que las tres pantallas de acceso español-only no se enteran.
- **El registro es el del producto, no el del landing.** El copy español que entra al `Dict` es
  el tuteo neutro que escribió la consola v2, no el voseo rioplatense del resto de `es.ts`. La
  0005 decidió que los dos registros conviven a propósito y esta enmienda no lo toca: mueve el
  texto de sitio, no de voz.
- **Los errores del servidor siguen donde ya viven.** `features/auth/actions.ts` recibe el idioma
  en un input oculto del form (un server action no ve el pathname) y responde con
  `dict.auth.errors`. La excepción es `InvalidAuthInputError` en el alta: `lib/auth/validation`
  devuelve un texto español que **dice qué campo falló**, y eso es mejor que un genérico, así que
  en español se propaga tal cual y solo el inglés cae al mensaje del diccionario.
- **Las cuatro pantallas privadas llevan `robots: noindex, nofollow`** vía
  `privatePageMetadata()` (`lib/seo.ts:87`). Es ortogonal al idioma, pero es parte de por qué
  estas rutas se tocan en la rama de SEO.

## Consequences

- **La frontera «producto = hardcoded» ya no coincide con «rutas de producto»**: son las siete de
  dentro de la sesión. Quien agregue una pantalla nueva tiene que decidir de qué lado cae, y el
  criterio es si la ve alguien sin sesión.
- **`lib/auth/validation` queda como el único texto de usuario en español fuera del `Dict`** en
  el camino de alta. Si algún día hace falta en inglés, el arreglo es ahí, no en el action.
- **Las páginas legales siguen sin gemela en inglés**, así que el pie del `AccessShell` traduce
  las etiquetas pero mantiene los enlaces a `/privacy` y `/terms`. Un usuario de `/en/register`
  cruza a español al pinchar «Privacy». Es el mismo compromiso que ya asumió `hasLocaleTwin()`.
- **`/docs` tampoco tiene gemela**: el enlace del topbar traduce la etiqueta y apunta a la
  documentación en español.

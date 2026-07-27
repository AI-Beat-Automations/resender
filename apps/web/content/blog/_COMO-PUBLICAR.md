# Cómo publicar un post en el blog

> Este archivo empieza con `_`, así que el blog lo ignora: no se publica.
> Es solo la guía. Copiá el ejemplo de más abajo para crear un post nuevo.

## Resumen en 3 pasos (todo desde el navegador, sin abrir código)

1. Entrá al repo en GitHub → carpeta `apps/web/content/blog/es/` (o
   `apps/web/content/blog/en/` si el post está en inglés).
2. Tocá **Add file → Create new file** (o **Upload files** si ya tenés el `.md`).
3. Nombrá el archivo, pegá el contenido y tocá **Commit changes**.

Al hacer commit **a la rama de producción**, se reconstruye el sitio en
Cloudflare y el post queda publicado solo en unos minutos.

> ⚠️ **Importante:** el post solo sale live si lo commiteás a la rama de
> producción (normalmente `main`). Si lo subís a otra rama, no aparece hasta que
> esa rama se mergee a producción.

## La carpeta = el idioma

El sitio tiene dos versiones: español en la raíz e inglés bajo `/en`. El blog
sigue la misma lógica y el idioma **sale de la carpeta**, no de nada que escribas
adentro del archivo:

| Carpeta | Se publica en |
|---|---|
| `apps/web/content/blog/es/` | `/blog` |
| `apps/web/content/blog/en/` | `/en/blog` |

**Si el post existe en los dos idiomas, usá exactamente el mismo nombre de
archivo en las dos carpetas.** Así el switch ES/EN del header lleva al lector de
una versión a la otra en vez de tirarle un 404. Un post que solo existe en un
idioma se publica igual; simplemente no aparece en el otro.

## El nombre del archivo = la URL

`es/limites-para-agentes-de-ia.md` → se publica en `/blog/limites-para-agentes-de-ia`
`en/limites-para-agentes-de-ia.md` → se publica en `/en/blog/limites-para-agentes-de-ia`

Reglas para el nombre:

- Todo en minúsculas.
- Palabras separadas por guiones `-` (sin espacios).
- Sin acentos ni ñ (usá `n`).
- Terminá en `.md`.

El nombre del archivo **NO** es el título. El título se toma de adentro del
archivo (ver abajo), así que no pongas la fecha ni nada raro en el nombre.

## Qué va adentro del archivo

Markdown normal. No hace falta ningún bloque de configuración. Solo tres cosas:

1. **El título**, como primer encabezado con un `#`.
2. **La fecha**, en la línea de abajo, en cursiva (entre asteriscos `*`).
3. **El contenido**.

### Ejemplo — copiá esto y editalo

```markdown
# Límites para agentes de IA

*23 de julio de 2026*

Este primer párrafo se usa como resumen en la lista del blog y en Google, así que
que sea claro y cuente de qué trata el post.

## Primera sección

Escribí lo que quieras. Podés usar **negrita**, *cursiva*, listas:

- Punto uno
- Punto dos

## Segunda sección

Si el post tiene dos o más secciones con `##`, arriba aparece automáticamente
una tabla de contenidos para saltar entre ellas.
```

### Cómo se ve

- El `# Título` sale grande arriba (no se repite dentro del texto).
- La fecha en cursiva sale como un textito gris debajo del título (no dentro del
  artículo).
- Cada `## Sección` arma la tabla de contenidos.

### Categoría (opcional, para el filtro del blog)

En la lista del blog hay un filtro con dos categorías: **Tutoriales** y
**Novedades**. Para que un post aparezca bajo una de ellas, escribí la
categoría **en la misma línea de la fecha**, separada con `·`:

```markdown
# Título del post

*Tutorial · 23 de julio de 2026*
```

Podés usar `Tutorial` o `Novedades` (también se aceptan `Actualización` y, en
posts en inglés, `Tutorial` / `News`). El orden no importa
(`*23 de julio de 2026 · Tutorial*` también funciona). Si no ponés categoría, el
post igual se publica y se ve en la lista, pero no queda dentro de ninguna de las
dos categorías del filtro.

> El `·` es un punto medio. En Mac lo escribís con **Option + Shift + 9**. Si te
> resulta más cómodo, también podés separar con `|` (ej. `*Tutorial | 23 de julio de 2026*`).

### Autor y fecha de actualización (opcional, pero suma en Google)

Si querés firmar el post o dejar constancia de que lo actualizaste, poné un
bloque de datos entre dos líneas de `---`, **arriba de todo el archivo**:

```markdown
---
author: Nombre y Apellido
updatedOn: 2026-09-15
---

# Título del post

*Tutorial · 23 de julio de 2026*
```

- **`author`** — el nombre de una persona real. Google lo usa como señal de que
  detrás del contenido hay alguien con experiencia en el tema, y aparece debajo
  del título. Si no lo ponés, el artículo queda firmado por Resender.
- **`updatedOn`** — la fecha de la última revisión, en formato `AAAA-MM-DD`.
  Ponela **solo si de verdad revisaste el post**: le dice a Google que el
  contenido sigue vigente, y una fecha falsa es una señal que después no vas a
  poder sostener.

> ⚠️ En ese bloque **no** pongas `title`: el título se sigue tomando del `#` del
> cuerpo, y si lo duplicás acá el post te va a mostrar el encabezado dos veces.

### Formatos de fecha válidos

Cualquiera de estos funciona (elegí el que te resulte más cómodo):

- `*23 de julio de 2026*`
- `*2026-07-23*`
- `*23/07/2026*`

En los posts en inglés también podés escribir el mes en inglés:

- `*July 23, 2026*`
- `*23 July 2026*`

Si no ponés fecha, el post igual se publica, pero sin fecha visible.

> ⚠️ Con barras la fecha siempre se lee **día/mes/año**, también en inglés:
> `*07/03/2026*` es el 7 de marzo. Si te genera dudas, usá el mes con nombre.

## Preguntas frecuentes

**¿Necesito estar en la computadora?** No. Todo se puede hacer desde el navegador
en GitHub, incluso desde el celular.

**¿Puedo poner imágenes?** Sí. Subí la imagen a `apps/web/public/blog/` (esa
carpeta todavía no existe: al subir la primera imagen desde GitHub se crea sola)
y usala con `![texto alternativo](/blog/mi-imagen.png)`. Escribí siempre el texto
alternativo entre los corchetes: es lo que leen los lectores de pantalla y lo que
usa Google para entender la imagen.

**¿Cómo borro o edito un post?** Editá o borrá el `.md` desde GitHub y hacé
commit. El sitio se actualiza solo.

**¿Puedo guardar un borrador sin publicarlo?** Sí: poné `_` al principio del
nombre del archivo (ej. `_borrador-mi-post.md`). El blog ignora todo lo que
empiece con `_`.

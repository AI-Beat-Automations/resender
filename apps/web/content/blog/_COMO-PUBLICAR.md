# Cómo publicar un post en el blog

> Este archivo empieza con `_`, así que el blog lo ignora: no se publica.
> Es solo la guía. Copiá el ejemplo de más abajo para crear un post nuevo.

## Resumen en 3 pasos (todo desde el navegador, sin abrir código)

1. Entrá al repo en GitHub → carpeta `apps/web/content/blog/`.
2. Tocá **Add file → Create new file** (o **Upload files** si ya tenés el `.md`).
3. Nombrá el archivo, pegá el contenido y tocá **Commit changes**.

Al hacer commit **a la rama de producción**, Vercel reconstruye el sitio y el
post queda publicado solo en unos minutos.

> ⚠️ **Importante:** el post solo sale live si lo commiteás a la rama que Vercel
> usa como producción (normalmente `main`). Si lo subís a otra rama, no aparece
> hasta que esa rama se mergee a producción.

## El nombre del archivo = la URL

`limites-para-agentes-de-ia.md` → se publica en `/blog/limites-para-agentes-de-ia`

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
**Actualizaciones**. Para que un post aparezca bajo una de ellas, escribí la
categoría **en la misma línea de la fecha**, separada con `·`:

```markdown
# Título del post

*Tutorial · 23 de julio de 2026*
```

Podés usar `Tutorial` o `Actualización`. El orden no importa
(`*23 de julio de 2026 · Tutorial*` también funciona). Si no ponés categoría, el
post igual se publica y se ve en la lista, pero no queda dentro de ninguna de las
dos categorías del filtro.

> El `·` es un punto medio. En Mac lo escribís con **Option + Shift + 9**. Si te
> resulta más cómodo, también podés separar con `|` (ej. `*Tutorial | 23 de julio de 2026*`).

### Formatos de fecha válidos

Cualquiera de estos funciona (elegí el que te resulte más cómodo):

- `*23 de julio de 2026*`
- `*2026-07-23*`
- `*23/07/2026*`

Si no ponés fecha, el post igual se publica, pero sin fecha visible.

## Preguntas frecuentes

**¿Necesito estar en la computadora?** No. Todo se puede hacer desde el navegador
en GitHub, incluso desde el celular.

**¿Puedo poner imágenes?** Sí. Subí la imagen a `apps/web/public/blog/` y usala
con `![texto alternativo](/blog/mi-imagen.png)`.

**¿Cómo borro o edito un post?** Editá o borrá el `.md` desde GitHub y hacé
commit. El sitio se actualiza solo.

**¿Puedo guardar un borrador sin publicarlo?** Sí: poné `_` al principio del
nombre del archivo (ej. `_borrador-mi-post.md`). El blog ignora todo lo que
empiece con `_`.

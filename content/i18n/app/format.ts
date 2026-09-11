/**
 * Interpolación de las plantillas del diccionario del producto.
 *
 * El `AppDict` es **solo strings**, sin funciones, y por eso las plantillas
 * llevan `{marcadores}` en vez de recibir argumentos: una función no cruza el
 * borde servidor→cliente, así que un diccionario con funciones adentro no se
 * podría pasar por props ni por contexto a los componentes cliente (el sidebar,
 * los formularios). Con strings, el diccionario entero es serializable.
 *
 * Un marcador sin valor se deja tal cual en vez de convertirse en `undefined`:
 * si falta un dato es mejor ver `{count}` en pantalla —y arreglarlo— que un
 * hueco silencioso.
 */
export function fmt(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  )
}

/** `{n, plural}` de los pobres: dos formas, elegidas por el llamador. */
export function plural(count: number, one: string, many: string): string {
  return fmt(count === 1 ? one : many, { count })
}

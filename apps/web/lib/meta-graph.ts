// Versión de Graph con la que hablan todas las llamadas a Meta de la web: el
// OAuth de Facebook y de Instagram, los envíos y las respuestas a comentarios.
// Subirla no es un cambio de cadena: Meta agrega y quita campos entre versiones,
// así que hay que releer los parsers de webhook y lo que devuelve cada endpoint
// antes de tocarla.
//
// Tiene una gemela en `apps/api/src/config.ts`, duplicada a propósito porque las
// dos apps no comparten runtime. Se suben juntas: si se separan, la web y el
// Worker le hablan a dos versiones distintas de Graph.
export const META_GRAPH_VERSION = "v23.0"

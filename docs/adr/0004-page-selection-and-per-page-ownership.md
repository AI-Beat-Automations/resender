---
status: accepted
---

# Selección de páginas post-callback y ownership evaluado página por página

Hoy el OAuth de Meta conecta **todas** las páginas que Meta devuelve, de forma all-or-nothing:
`exchangeCodeForPages` trae lo que haya en `/me/accounts` y `connectAuthorizedPages` las
persiste todas (`lib/meta.ts`, `lib/pages/page-registry.ts`, `app/api/meta/callback/route.ts`).
Eso rompe por dos lados distintos:

1. **Límite de páginas por plan** (ADR 0003): un tenant Starter puede autorizar 7 páginas en el
   diálogo de Meta y volver al callback con 7.
2. **Ownership compartido**, que es el caso que motivó este ADR: Arturo administra las páginas
   A, B, C y D y conecta A y B. Felipe **también administra las cuatro** y quiere conectar C y D.
   Hoy `assertPagesConnectable` recorre la lista completa y, al encontrar que A ya pertenece a
   otro tenant, lanza `PageOwnershipError` y **cae todo el flujo**: Felipe no puede conectar C
   ni D, que no son de nadie.

La decisión es introducir una **pantalla de selección** entre el callback y la conexión, y
evaluar el ownership **por página** en lugar de all-or-nothing.

## Considered Options

- **Rechazar el callback si vienen más páginas de las permitidas** — rechazado. Barato de
  implementar, pero castiga al usuario por algo que hizo en una pantalla de Meta que nosotros no
  controlamos, y no resuelve nada del caso Felipe.
- **Persistir las páginas no elegidas como filas `pending` con su token cifrado, y borrarlas al
  confirmar** — rechazado. Es el camino más directo, pero guarda secretos de páginas que el
  usuario nunca conectó, y si abandona la pantalla esos tokens quedan en la base indefinidamente.
- **Persistir el user access token de larga duración y re-pedir `/me/accounts` al confirmar** —
  elegido. Los tokens de las páginas descartadas nunca tocan la base.

## Decisiones de dominio (fijadas en la entrevista)

- **Pantalla de selección después del callback.** El usuario elige qué páginas conectar, dentro
  del límite de su plan. Reemplaza la conexión automática de todas.
- **Ownership por página.** Una página sigue perteneciendo a un solo tenant (sin transferencia
  automática, igual que antes), pero que una esté tomada ya no invalida el resto de la lista.
  `assertPagesConnectable` deja de lanzar y pasa a clasificar. Esto **revierte** la regla
  all-or-nothing registrada en `CONTEXT.md`.
- **Las páginas tomadas se muestran, no se ocultan.** Aparecen deshabilitadas con un cartel de
  que ya están conectadas en otra cuenta. Ocultarlas dejaría a Felipe sin entender por qué le
  falta una página que él sí administra; mostrarlas le revela que alguien más la registró en
  Resender, y ese trade-off se acepta a favor de que el usuario entienda qué está pasando.
- **La pantalla solo agrega.** Desmarcar una página ya conectada **no** la desconecta.
  Desconectar sigue siendo una acción explícita, con su confirmación, en `/connections`
  (`CONTEXT.md`). Así el flujo de reconexión —que un usuario corre cuando Meta le invalida un
  token— no puede desconectarle páginas por accidente.
- **El user access token de larga duración se persiste cifrado por tenant.** Hoy
  `exchangeCodeForPages` lo obtiene y lo descarta (`lib/meta.ts`); pasa a guardarse con el mismo
  `lib/crypto/encryption` que ya protege los page tokens. Al confirmar la selección se vuelve a
  llamar `/me/accounts` con él y se guardan **únicamente** los page tokens de las elegidas.
  Beneficio adicional: agregar una página más adelante ya no exige repetir el OAuth de Meta.
- **Solo se suscriben al webhook las páginas seleccionadas** (`subscribePagesToWebhook`), no la
  lista completa que devolvió Meta.
- **El límite de páginas cuenta solo las `active`.** Desconectar es un `UPDATE` a
  `'disconnected'`, no un `DELETE`; las desconectadas no ocupan cupo, pero reconectar una
  estando en el tope se bloquea igual que conectar una nueva.

## Consequences

- Migración nueva: columna para el user access token cifrado por tenant.
- Nuevo secreto en la base con su propio riesgo: un user token de larga duración da acceso a
  **todas** las páginas del usuario, no solo a las conectadas. Va cifrado y nunca sale al cliente.
- **Bug a corregir antes de persistirlo**: `lib/meta.ts` cae en silencio al token corto si el
  intercambio a long-lived falla (`longData.access_token ?? shortToken`). Guardar ese token
  significaría guardar una credencial que muere en ~1 hora y romper la selección sin señal clara.
  Debe fallar explícito.
- Los page access tokens de larga duración no expiran por tiempo (solo se invalidan por eventos
  como cambio de password o revocación), así que re-pedir `/me/accounts` al confirmar es
  confiable mientras el user token siga vivo.
- `connectAuthorizedPages` deja de ser la única puerta de entrada: la conexión pasa a ocurrir
  en dos tiempos (callback → selección), y la garantía all-or-nothing que hoy da esa función
  se reduce al subconjunto seleccionado.
- El App Review de Meta no se ve afectado: los permisos del `config_id`
  (`pages_show_list`, `pages_messaging`, `pages_manage_metadata`) siguen siendo exactamente los
  que este flujo necesita.

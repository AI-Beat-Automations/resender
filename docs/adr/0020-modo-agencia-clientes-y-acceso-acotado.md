---
status: proposed
---

# Modo agencia: clientes de agencia con acceso acotado

Fecha: 2026-09-12. Entrega en cuatro PRs sobre `dev`; este borrador acompaña al primero (base,
sin cambio de comportamiento).

## Contexto

Hasta acá **un usuario es un tenant** (`tenantId = users.id`, ADR 0005 y 0014). Pero quien
construye el bot —la agencia— casi nunca es el dueño del negocio cuyas cuentas de Meta hay que
conectar. Hoy la agencia tiene que pedirle las credenciales de Instagram o Facebook a su cliente,
o el cliente tiene que abrir su propia cuenta de Resender y pagarla.

Se quiere que la agencia sea dueña de la cuenta —paga, tiene las API keys y los webhooks, ve
todo— y que pueda darle a cada negocio un acceso acotado para conectar y desconectar **sus**
cuentas y ver **su** Inbox, sin ver nada de otros negocios, ni lo técnico, ni la facturación.

## Considered Options

- **Plugin `organization` de Better Auth.** Trae organizaciones, miembros, roles e
  invitaciones. Rechazada: expone endpoints HTTP bajo `/api/auth/*` y está pensado para un
  `authClient` que el repositorio no tiene a propósito, y guarda la organización activa en la
  sesión, cuya cookie cache dura cinco minutos. La doctrina del repo es que **ninguna bandera de
  acceso viaja en la sesión**: revocar un acceso tiene que pegar en la siguiente request.
- **Un tenant por cliente, con acceso delegado a la agencia.** Rechazada: la suscripción, el
  cupo y las API keys quedarían del lado del negocio, y la agencia necesitaría una cuenta paga por
  cliente.
- **`agency_client_id` en todas las tablas con `tenant_id`.** Rechazada: conversaciones,
  mensajes y comentarios ya cuelgan de una conexión, así que el alcance se deriva de
  `connected_pages` y reasignar una conexión no obliga a reescribir su historial.
- **Conservar la cuenta de la persona al revocarle el acceso.** Rechazada: sería una fila de
  `users` sin tenant propio que al volver a entrar caería en `/billing`, y complica borrar la
  agencia. La persona solo existía para entrar a ese cliente.
- **Una sección "Clientes" aparte en el menú.** Rechazada: el trabajo habitual es crear el
  cliente, invitarlo y ver cómo conecta, y eso pasa en Conexiones. Conexiones se agrupa por
  cliente con un grupo "Sin asignar".
- **Token de invitación en el path (`/invite/<token>`).** Rechazada: la redacción de PostHog
  solo tapa el parámetro de query `token`, y el path completo quedaría guardado en
  `$current_url`.

## Decisión

- El tenant sigue siendo `users.id` del dueño. Dentro de él hay **clientes de agencia**
  (`agency_clients`). Cada uno tiene como mucho una persona (`agency_client_members`, una
  persona por cliente en v1) y las conexiones que tiene asignadas (`connected_pages.agency_client_id`;
  `null` es "sin asignar"). Las foreign keys a `agency_clients` son compuestas con `tenant_id`, así
  que la base impide cruzar tenants.
- **Actor** (`lib/auth/actor.ts`): quién opera, leído vivo en cada request y nunca guardado en
  la sesión. Puede ser `owner` (`userId = tenantId`) o `client` (tiene su propio `userId`, opera
  en el tenant de la agencia y lleva `clientId`). El gate de acceso mira a la persona; la
  suscripción y los permisos de canal miran al tenant. Una persona de un cliente cuya agencia no
  paga va a `/access`, nunca a precios.
- **Alcance** (`lib/pages/connection-scope.ts`): el dueño ve todo el tenant; la persona de un
  cliente, solo las conexiones de su cliente. Se aplica en el registro de conexiones, el Inbox
  (mensajes y comentarios), los medios de WhatsApp y los flujos de conexión de los tres canales.
  Lo que conecta la persona de un cliente queda asignado a su cliente. Esa persona **no puede
  tomar** una conexión sin asignar ni una de otro cliente: se le muestra como "de otra cuenta" y
  el dueño decide asignarla.
- **El token de usuario de Meta y el nonce de WhatsApp son por persona**, no por tenant: el
  dueño y la persona de un cliente comparten tenant y no pueden pisarse la autorización.
- **Solo el dueño**, y verificado en el servidor: `webhookUrl`, secreto de firma, API keys,
  facturación, borrar la cuenta y administrar clientes. El PIN de verificación en dos pasos de
  un número de WhatsApp lo ven el dueño y la persona del cliente al que está asignado, porque el
  número es de ese negocio.
- La API externa se autentica con una API key, que es del dueño, y ve todo el tenant.

## Consequences

- **Cupo y cuota siguen siendo del tenant** (ADR 0003 y 0011). Las conexiones de todos los
  clientes ocupan cupo de la agencia, y un post viral de un cliente puede agotar la cuota y dejar
  restringidos a todos. En v1 queda documentado y sin mitigación.
- Reasignar una conexión mueve también su historial visible: el nuevo cliente ve las
  conversaciones anteriores.
- Borrar un cliente borra a su persona y devuelve sus conexiones a "sin asignar". Revocar un
  acceso borra el usuario de esa persona. Borrar la agencia borra también a las personas de sus
  clientes.
- Fuera de alcance: `agencyClientId` en el payload del push y en `/v1/pages`, porque cambia el
  contrato público.

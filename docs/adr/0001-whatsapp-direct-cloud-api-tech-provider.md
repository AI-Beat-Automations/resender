---
status: accepted
---

# WhatsApp se integra directo contra la Cloud API como Tech Provider (no vía BSP)

Resender ya integra Messenger directamente contra `graph.facebook.com` (OAuth con `config_id`, tokens cifrados, webhook firmado), y es multi-tenant: cada tenant conecta sus propios assets de Meta. Para el canal WhatsApp se decidió seguir el mismo patrón —resender actúa como su **propio Tech Provider** y onboardea los WABA/números de los tenants mediante **Embedded Signup**, llamando luego a la Cloud API directamente (registrar número, suscribir webhook, enviar/recibir, plantillas)— en lugar de delegar en un BSP (Twilio, 360dialog, etc.).

## Considered Options

- **Directo (Cloud API, Tech Provider)** — elegido. Sin markup por mensaje, control total y simetría con el código de Messenger ya existente. A cambio, resender carga con los trámites únicos de Meta: Business Verification, App Review (`whatsapp_business_messaging` + `whatsapp_business_management`), configuración de Embedded Signup y pasar la app a Live.
- **Vía BSP** — rechazado. Menor time-to-market y menos trámites Meta directos, pero costo por mensaje, dependencia de un tercero, menos control y rompe la simetría con la integración directa que ya tiene Messenger.

## Consequences

- El cuello de botella es administrativo, no de código: Business Verification + App Review pueden tardar semanas → arrancar antes de tener el código.
- Migrar a un BSP más adelante implicaría re-onboardear a todos los tenants (re-consentimiento vía Embedded Signup), por eso la decisión es difícil de revertir.
- Los bloqueadores de plataforma ya detectados para Messenger en `fb_requirements.md` (política de privacidad, eliminación de datos, términos, acceso de prueba para el revisor) son **compartidos** y aplican igual a WhatsApp.

-- migration 0031: el envío de plantillas de WhatsApp por API (ADR 0024,
-- issue #190)
-- `POST /api/meta/whatsapp/templates/send` manda una [Plantilla] aprobada a un
-- contacto con la ventana de 24 h cerrada o que nunca escribió. El saliente se
-- guarda en `messages` como cualquier otro, y esta columna dice qué plantilla
-- salió.
--
-- `template_meta` guarda `{ name, language, components }` **de ese envío**:
-- los parámetros con que se llenó la plantilla en ese momento, no una
-- referencia a la copia local de la plantilla, que puede cambiar o
-- desaparecer. Null en todo lo que no es una plantilla.
--
-- Una plantilla **no** es un [Adjunto]: `attachment_type` queda null. El check
-- de la 0016 (`text is not null or attachment_type is not null`) se cumple con
-- `text = ''`, igual que en un saliente con adjunto sin texto.

alter table messages add column if not exists template_meta jsonb;

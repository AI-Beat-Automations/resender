-- migration 0016: adjuntos entrantes en messages
--
-- Un mensaje de Messenger puede llegar sin texto y con adjunto (una foto, un
-- audio, un share), y hasta hoy esos mensajes se descartaban en el parser. Para
-- persistirlos, `messages` suma tres columnas nullable: el tipo del adjunto, su
-- URL (efímera, la firma el CDN de Meta) y un jsonb con los detalles que varían
-- por tipo (sticker_id, booking, elementos de producto, etc.). Un mensaje puede
-- traer texto, adjunto o los dos —un share con comentario trae ambos—, así que
-- las columnas son independientes de `text`.
--
-- `text` deja de ser not null: la regla "texto XOR adjunto" vale solo al
-- **enviar** y vive en el parser de salida, no en la base. La fila admite
-- texto, adjunto o los dos; lo único que la base rechaza es la fila vacía, que
-- no representa nada (check `messages_content_present_check`).

alter table messages alter column text drop not null;

alter table messages
  add column if not exists attachment_type text,
  add column if not exists attachment_url text,
  add column if not exists attachment_meta jsonb;

-- Catálogo cerrado de tipos, el mismo que `INBOUND_ATTACHMENT_TYPES` en
-- `lib/inbound/inbound-event.ts` (que también cubre los cuatro tipos de
-- salida: image, audio, video, file). `unknown` está a propósito: un tipo
-- nuevo de Meta entra igual, con su nombre real guardado en
-- `attachment_meta.rawType`, en vez de romper la ingesta.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_attachment_type_check'
  ) then
    alter table messages
      add constraint messages_attachment_type_check
        check (
          attachment_type is null
          or attachment_type in (
            'image', 'audio', 'video', 'file', 'sticker', 'reel', 'ig_reel',
            'post', 'ig_post', 'fallback', 'appointment_booking', 'template',
            'unknown'
          )
        );
  end if;
end $$;

-- La fila vacía no existe: sin texto y sin adjunto no hay mensaje que mostrar
-- ni que reenviar. Se exige `attachment_type` y no `attachment_url` porque un
-- adjunto sin URL es legal: `appointment_booking` y `template` no traen URL,
-- y un `fallback` o un `unknown` pueden venir sin payload.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_content_present_check'
  ) then
    alter table messages
      add constraint messages_content_present_check
        check (text is not null or attachment_type is not null);
  end if;
end $$;

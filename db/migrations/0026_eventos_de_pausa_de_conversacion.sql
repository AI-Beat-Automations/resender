-- migration 0026: historial de pausa por conversación (ADR 0021)
-- `conversations.paused_at` (0025) dice el estado de ahora y nada más: al
-- reanudar se pone en null y se pierde cuándo se pausó y cuándo se reactivó.
-- El hilo de Inbox quiere contar eso como parte de la conversación —«pausada
-- desde el 14 sep, 10:32», «activada desde el 14 sep, 11:05»— intercalado con
-- los mensajes, así que cada cambio queda como una fila propia.
--
-- Solo conversaciones, no conexiones: la pausa de conexión no tiene un hilo
-- donde contarse. Y `paused_at` se queda: es lo que lee la ingesta para decidir
-- si reenvía, y una columna es más barata que el último evento por fila.

create table if not exists conversation_pause_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references users(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  -- true = se pausó, false = se reactivó. `created_at` es cuándo.
  paused boolean not null,
  created_at timestamptz not null default now()
);

-- El hilo lee «los eventos de esta conversación, en orden».
create index if not exists conversation_pause_events_conversation_idx
  on conversation_pause_events (conversation_id, created_at);

-- Lo que ya está pausado nace con su evento, fechado en el `paused_at` real:
-- si no, el hilo diría «activa» arriba y nada abajo, contradiciendo al switch.
insert into conversation_pause_events (tenant_id, conversation_id, paused, created_at)
select tenant_id, id, true, paused_at
from conversations
where paused_at is not null;

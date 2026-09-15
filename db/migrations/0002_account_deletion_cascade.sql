-- migration 0002: account deletion via cascade
-- Switch the foreign keys that reference users (directly and transitively) from
-- `on delete restrict` to `on delete cascade`, so deleting a tenant reduces to
-- `delete from users where id = $tenantId` and the dependent rows go with it.
-- `external_webhook_deliveries.message_id` is already `on delete cascade` (0001).
-- Constraint names are the Postgres defaults emitted by the inline references in 0001.

alter table connected_pages
  drop constraint connected_pages_tenant_id_fkey,
  add constraint connected_pages_tenant_id_fkey
    foreign key (tenant_id) references users(id) on delete cascade;

alter table conversations
  drop constraint conversations_tenant_id_fkey,
  add constraint conversations_tenant_id_fkey
    foreign key (tenant_id) references users(id) on delete cascade,
  drop constraint conversations_connected_page_id_fkey,
  add constraint conversations_connected_page_id_fkey
    foreign key (connected_page_id) references connected_pages(id) on delete cascade;

alter table messages
  drop constraint messages_tenant_id_fkey,
  add constraint messages_tenant_id_fkey
    foreign key (tenant_id) references users(id) on delete cascade,
  drop constraint messages_conversation_id_fkey,
  add constraint messages_conversation_id_fkey
    foreign key (conversation_id) references conversations(id) on delete cascade,
  drop constraint messages_connected_page_id_fkey,
  add constraint messages_connected_page_id_fkey
    foreign key (connected_page_id) references connected_pages(id) on delete cascade;

alter table api_keys
  drop constraint api_keys_tenant_id_fkey,
  add constraint api_keys_tenant_id_fkey
    foreign key (tenant_id) references users(id) on delete cascade;

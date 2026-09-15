-- migration 0003: visible page token health
-- When Meta returns OAuthException code 190, Resender keeps the Page connected
-- but surfaces that the page token must be refreshed by reconnecting the Page.

alter table connected_pages
  add column token_status text not null default 'valid'
    check (token_status in ('valid', 'invalid')),
  add column token_error text,
  add column token_error_at timestamptz;

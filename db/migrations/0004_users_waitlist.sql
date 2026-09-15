-- migration 0004: waitlist gate for new signups
-- Registration stays open, but a new account lands on the waitlist and cannot
-- use the product until someone flips the flag:
--   update users set waitlisted = false where email = '...';
-- Accounts that already existed when this migration ran are grandfathered in,
-- so the Meta App Review account keeps working.

alter table users
  add column waitlisted boolean not null default true;

update users set waitlisted = false;

create index if not exists users_waitlisted_idx on users(created_at desc)
  where waitlisted;

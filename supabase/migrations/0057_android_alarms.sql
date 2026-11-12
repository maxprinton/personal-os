-- Personal OS - 0057: alarmas en el telefono Android (app propia).
-- 1) Cada bloque (por nombre) puede tener una alarma: cuantos minutos antes de empezar (0 = a la hora exacta).
--    null = sin alarma. Es del tipo de bloque, asi que vale para todos los dias de ese bloque.
-- 2) Una clave personal para la app del telefono. Solo se guarda su huella (hash), nunca la clave.
-- Aditiva y segura de correr dos veces. No cambia nada existente.

alter table public.block_types
  add column if not exists alarm_minutes_before smallint
  check (alarm_minutes_before is null or alarm_minutes_before between 0 and 180);

alter table public.user_settings add column if not exists alarm_key_hash text;
alter table public.user_settings add column if not exists alarm_key_created_at timestamptz;

create unique index if not exists user_settings_alarm_key_idx
  on public.user_settings (alarm_key_hash) where alarm_key_hash is not null;

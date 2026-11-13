-- Personal OS - 0058: reglas de alarma por bloque (anillos al inicio o al final, con repeticiones).
-- Cada tipo de bloque (por nombre) guarda una lista de "anillos" en JSON:
--   [{anchor:"start"|"end", offset:-180..180 (minutos, negativo = antes), sound, repeatSound, style:"alarm"|"notify",
--     repeats:0..5, every:1..30, louder:true|false}]
-- null = sin reglas nuevas: sigue valiendo alarm_minutes_before (0057). [] = sin alarma.
-- Aditiva y segura de correr dos veces. No cambia nada existente.

alter table public.block_types add column if not exists alarm_rules jsonb
  check (alarm_rules is null or jsonb_typeof(alarm_rules) = 'array');

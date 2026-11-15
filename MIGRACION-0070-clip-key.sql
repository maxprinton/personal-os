-- Personal OS - 0070: clave personal para la extension de Chrome (Coursera -> Notes).
-- Solo se guarda la huella (hash) de la clave, nunca la clave. Aditiva y segura de correr dos veces.
alter table public.user_settings add column if not exists clip_key_hash text;
alter table public.user_settings add column if not exists clip_key_created_at timestamptz;
create unique index if not exists user_settings_clip_key_idx on public.user_settings (clip_key_hash) where clip_key_hash is not null;

-- Last time the extension saved something (shown in Settings, used by the test mission probes).
alter table public.user_settings add column if not exists clip_last_used_at timestamptz;

-- Test mission probes (BL-94): true when the feature left a trace after the mission was created.
create or replace function public.tprobe_clip_saved(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public' as $$
  select exists (select 1 from user_settings where user_id = p_user and clip_last_used_at > p_since)
$$;

create or replace function public.tprobe_clip_pair(p_user uuid, p_since timestamptz) returns boolean
  language sql stable set search_path to 'public' as $$
  select exists (
    select 1 from entity_tags et
    where et.user_id = p_user and et.entity_type = 'note' and et.deleted_at is null and et.created_at > p_since
    group by et.tag_id having count(distinct et.entity_id) >= 2)
$$;

revoke execute on function public.tprobe_clip_saved(uuid, timestamptz) from public, anon;
revoke execute on function public.tprobe_clip_pair(uuid, timestamptz) from public, anon;
grant execute on function public.tprobe_clip_saved(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.tprobe_clip_pair(uuid, timestamptz) to authenticated, service_role;

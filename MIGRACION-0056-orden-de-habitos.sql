-- Personal OS: el usuario elige el orden de los habitos dentro de cada bloque.
alter table public.habits add column if not exists sort_order integer;

-- Orden actual (por creacion) como punto de partida, por bloque
update public.habits h
   set sort_order = r.n
  from (
    select id, row_number() over (partition by user_id, block_type_id order by created_at) - 1 as n
      from public.habits
     where deleted_at is null
  ) r
 where h.id = r.id and h.sort_order is null;

-- Add-ons library (Nov 2026): which add-ons are pinned to the main menu.
-- Optional: without it the favorites are remembered only in this browser.
alter table public.user_settings
  add column if not exists addon_favorites text[] not null default array['teaching']::text[];

select 'user_settings.addon_favorites' as checked, count(*)::text as found
from information_schema.columns
where table_schema = 'public' and table_name = 'user_settings' and column_name = 'addon_favorites';

-- Personal OS - 0038: the theme you picked last (auto / light / dark), the same on every device (Nov 2026).
-- Safe to run twice. Without it the theme is remembered only in each browser (dark by default).
alter table public.user_settings add column if not exists theme text;
alter table public.user_settings drop constraint if exists user_settings_theme_check;
alter table public.user_settings add constraint user_settings_theme_check check (theme is null or theme in ('auto', 'light', 'dark'));

select 'user_settings.theme' as checked, count(*)::text as found
from information_schema.columns
where table_schema = 'public' and table_name = 'user_settings' and column_name = 'theme';

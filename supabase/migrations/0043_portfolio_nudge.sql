-- Portfolio add-on, Phase 8: switch for the weekly Telegram nudge ("pages changed but not republished").
-- Additive and safe: one boolean column, on by default.
alter table public.portfolio_site add column if not exists nudge_weekly boolean not null default true;

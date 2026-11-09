-- Focus of a finished block (1 scattered, 2 normal, 3 locked in) and "was it worth it?" of a purchase. Both optional.
alter table public.block_occurrences add column if not exists focus smallint check (focus between 1 and 3);
alter table public.transactions add column if not exists worth_it boolean;

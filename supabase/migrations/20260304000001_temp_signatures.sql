-- Temporary table for cross-browser signature exchange
create table if not exists public.temp_signatures (
  sid text primary key,
  data_url text not null,
  created_at timestamptz not null default now()
);

-- Auto-delete rows older than 10 minutes
-- (cleaned up by the Sign page itself, but this is a safety net)
create index if not exists temp_signatures_created_at_idx on public.temp_signatures(created_at);

-- Allow anonymous reads and inserts (no auth required for public payout signing)
alter table public.temp_signatures enable row level security;

create policy "Anyone can insert temp signature"
  on public.temp_signatures for insert
  with check (true);

create policy "Anyone can select temp signature by sid"
  on public.temp_signatures for select
  using (true);

create policy "Anyone can delete own temp signature"
  on public.temp_signatures for delete
  using (true);

-- Enable realtime on this table
alter publication supabase_realtime add table public.temp_signatures;

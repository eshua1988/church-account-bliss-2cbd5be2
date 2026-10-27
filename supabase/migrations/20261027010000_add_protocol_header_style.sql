alter table public.protocol_link_settings
  add column if not exists church_header_style text not null default 'classic';

alter table public.protocol_link_settings
  add column if not exists church_name text not null default '',
  add column if not exists church_header_image text,
  add column if not exists show_church_header boolean not null default false;

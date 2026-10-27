alter table public.protocol_link_settings
  add column if not exists church_header_font_family text not null default 'roboto';
